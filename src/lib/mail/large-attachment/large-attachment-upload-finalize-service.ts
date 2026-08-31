import { and, eq, isNull } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import {
  loadDraftDetail,
  requireAuthorDraft,
  resolveActorUser,
  type DraftDetailView,
} from "@/lib/mail/draft-service";
import { MailServiceError } from "@/lib/mail/errors";
import {
  assertBatchUpdateChanged,
  buildDraftVersionGuardedAuditInsert,
  isMailPostStateGuardError,
  runMailBatch,
} from "@/lib/mail/guarded-batch";
import {
  LARGE_ATTACHMENT_DEDICATED_BUCKET_NAME,
  LARGE_ATTACHMENT_TEMPORARY_RETENTION_MS,
  addMillisecondsToIsoTimestamp,
} from "@/lib/mail/large-attachment/large-attachment-constants";
import { headLargeAttachmentObjectAuthoritative } from "@/lib/mail/large-attachment/large-attachment-r2-head-service";
import { createTemporaryLargeAttachmentLifecycle } from "@/lib/mail/large-attachment/large-attachment-state-machine";
import { largeAttachmentStoredFileScanStatusOnFinalize } from "@/lib/mail/large-attachment/large-attachment-security";
import {
  assertStorageIdentityDistinctFromContentHash,
  type LargeAttachmentStorageIdentity,
} from "@/lib/mail/large-attachment/large-attachment-storage-identity";
import {
  findUploadSessionById,
  markUploadSessionFinalized,
} from "@/lib/mail/large-attachment/large-attachment-upload-repository";
import {
  evaluateLargeAttachmentUploadFinalize,
  type LargeAttachmentUploadSession,
} from "@/lib/mail/large-attachment/large-attachment-upload-session";

export type LargeAttachmentFinalizePorts = {
  headObject?: typeof headLargeAttachmentObjectAuthoritative;
  trustNow?: () => Date;
};

function normalizeContentType(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value.trim().toLowerCase();
}

export async function finalizeLargeAttachmentUpload(
  db: Database,
  actor: MailActorContext,
  input: {
    draftId: string;
    sessionId: string;
    expectedAutosaveVersion: number;
    ports?: LargeAttachmentFinalizePorts;
  },
): Promise<DraftDetailView> {
  const draft = await requireAuthorDraft(db, actor, input.draftId);
  const session = await findUploadSessionById(db, input.sessionId);
  if (!session || session.draftId !== draft.id) {
    throw MailServiceError.notFound("Upload session not found");
  }
  if (session.actorUserId !== actor.userId) {
    throw MailServiceError.forbidden("Upload session actor mismatch");
  }
  if (session.mailboxId !== draft.mailboxId) {
    throw MailServiceError.validation("Upload session mailbox mismatch");
  }
  if (session.invalidatedAt) {
    throw MailServiceError.validation("Upload session invalidated", {
      issueCode: "SESSION_INVALIDATED",
    });
  }

  const trustNow = input.ports?.trustNow?.() ?? new Date();
  const trustNowIso = trustNow.toISOString();

  if (
    !session.finalizedAt &&
    Date.parse(session.expiresAt) <= trustNow.getTime()
  ) {
    throw MailServiceError.validation("Upload authorization expired", {
      issueCode: "SESSION_EXPIRED",
    });
  }

  const head = input.ports?.headObject ?? headLargeAttachmentObjectAuthoritative;
  const observed = await head(session.storageKey);
  if (!observed) {
    throw MailServiceError.validation("Uploaded object not found in storage", {
      issueCode: "OBJECT_MISSING",
    });
  }
  if (!observed.etag) {
    throw MailServiceError.validation("Uploaded object ETag is missing", {
      issueCode: "ETAG_MISSING",
    });
  }

  const observedContentType = normalizeContentType(observed.contentType);
  const expectedContentType = normalizeContentType(session.expectedMimeType);
  if (
    !observedContentType ||
    !expectedContentType ||
    observedContentType !== expectedContentType
  ) {
    throw MailServiceError.validation("Uploaded object Content-Type mismatch", {
      issueCode: "CONTENT_TYPE_MISMATCH",
    });
  }

  assertStorageIdentityDistinctFromContentHash({
    declaredContentHash: session.declaredContentHash,
    storageEtag: observed.etag,
  });

  const storageIdentity: LargeAttachmentStorageIdentity = {
    storageEtag: observed.etag,
    storageVersion: observed.storageVersion ?? "",
    sizeBytes: observed.sizeBytes,
    finalizedAt: session.finalizedAt ?? trustNowIso,
  };

  const evaluation = evaluateLargeAttachmentUploadFinalize({
    session,
    observedSizeBytes: observed.sizeBytes,
    observedStorageKey: session.storageKey,
    storageIdentity,
    trustNowIso,
  });
  if (!evaluation.ok) {
    throw MailServiceError.validation(evaluation.message, {
      issueCode: evaluation.code,
    });
  }

  if (evaluation.idempotentReplay && session.storedFileId) {
    const user = await resolveActorUser(actor);
    const current = await findDraftById(db, draft.id);
    if (!current) {
      throw MailServiceError.notFound("Draft not found");
    }
    return loadDraftDetail(db, current, user);
  }

  const now = trustNowIso;
  const storedFileId = session.storedFileId ?? crypto.randomUUID();
  const lifecycleId = crypto.randomUUID();
  const draftAttachmentId = crypto.randomUUID();
  const nextVersion = draft.autosaveVersion + 1;
  const auditId = crypto.randomUUID();
  const uploadedAt = now;
  const temporaryExpiresAt = addMillisecondsToIsoTimestamp(
    uploadedAt,
    LARGE_ATTACHMENT_TEMPORARY_RETENTION_MS,
  );

  const lifecycle = createTemporaryLargeAttachmentLifecycle({
    id: lifecycleId,
    storedFileId,
    uploadedAt,
    declaredContentHash: session.declaredContentHash,
    storageVersion: observed.storageVersion ?? "",
    storageEtag: observed.etag,
    finalizedAt: now,
  });

  const existingAttachments = await db
    .select({ sortOrder: schema.mailDraftAttachments.sortOrder })
    .from(schema.mailDraftAttachments)
    .where(eq(schema.mailDraftAttachments.draftId, draft.id));
  const nextSortOrder =
    existingAttachments.length > 0
      ? Math.max(...existingAttachments.map((row) => row.sortOrder)) + 1
      : 0;

  try {
    const results = await runMailBatch(db, [
      db.insert(schema.mailStoredFiles).values({
        id: storedFileId,
        contentHash: session.declaredContentHash,
        originalFilename: session.expectedFilename,
        mimeType: session.expectedMimeType,
        sizeBytes: observed.sizeBytes,
        storageProvider: "r2",
        storageBucket: LARGE_ATTACHMENT_DEDICATED_BUCKET_NAME,
        storageKey: session.storageKey,
        createdByUserId: actor.userId,
        securityScanStatus: largeAttachmentStoredFileScanStatusOnFinalize(),
        securityScannedAt: null,
        createdAt: now,
      }),
      db.insert(schema.mailLargeAttachmentLifecycle).values({
        id: lifecycle.id,
        storedFileId,
        status: lifecycle.status,
        uploadedAt: lifecycle.uploadedAt,
        temporaryExpiresAt,
        approvalHoldStartedAt: lifecycle.approvalHoldStartedAt,
        approvalAbsoluteExpiresAt: lifecycle.approvalAbsoluteExpiresAt,
        sentAt: lifecycle.sentAt,
        recipientExpiresAt: lifecycle.recipientExpiresAt,
        deletedAt: lifecycle.deletedAt,
        deleteReason: lifecycle.deleteReason,
        downloadTokenHash: lifecycle.downloadTokenHash,
        downloadCount: lifecycle.downloadCount,
        lastDownloadedAt: lifecycle.lastDownloadedAt,
        declaredContentHash: lifecycle.declaredContentHash,
        storageVersion: observed.storageVersion,
        storageEtag: lifecycle.storageEtag,
        finalizedAt: lifecycle.finalizedAt,
        createdAt: lifecycle.createdAt,
        updatedAt: lifecycle.updatedAt,
      }),
      db.insert(schema.mailDraftAttachments).values({
        id: draftAttachmentId,
        draftId: draft.id,
        storedFileId,
        displayFilename: session.expectedFilename,
        sortOrder: nextSortOrder,
        deliveryMode: "large_attachment",
        secureExpiryDays: null,
        createdAt: now,
        updatedAt: now,
      }),
      db
        .update(schema.mailDrafts)
        .set({
          autosaveVersion: nextVersion,
          lastSavedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.mailDrafts.id, draft.id),
            eq(schema.mailDrafts.autosaveVersion, input.expectedAutosaveVersion),
            isNull(schema.mailDrafts.discardedAt),
          ),
        ),
      buildDraftVersionGuardedAuditInsert(
        db,
        actor,
        { draftId: draft.id, expectedAutosaveVersion: nextVersion },
        {
          auditId,
          now,
          action: MAIL_AUDIT_ACTIONS.draftAttachmentAdded,
          entityId: draft.id,
          entityType: "mail_draft",
          metadata: {
            draftId: draft.id,
            draftAttachmentId,
            storedFileId,
            deliveryMode: "large_attachment",
            uploadSessionId: session.id,
            actorUserId: actor.userId,
          },
        },
      ),
    ]);
    assertBatchUpdateChanged(results, 3, "Large attachment finalize conflict");
    await markUploadSessionFinalized(db, {
      sessionId: session.id,
      storedFileId,
      finalizedAt: now,
    });
  } catch (error) {
    if (isMailPostStateGuardError(error)) {
      throw MailServiceError.staleVersion("Large attachment finalize conflict");
    }
    throw error;
  }

  const user = await resolveActorUser(actor);
  const updated = await findDraftById(db, draft.id);
  if (!updated) {
    throw MailServiceError.integrityConflict("Large attachment finalize failed");
  }
  return loadDraftDetail(db, updated, user);
}

async function findDraftById(db: Database, draftId: string) {
  const [draft] = await db
    .select()
    .from(schema.mailDrafts)
    .where(eq(schema.mailDrafts.id, draftId))
    .limit(1);
  return draft ?? null;
}

export function buildFinalizeStorageIdentityFromSession(
  session: LargeAttachmentUploadSession,
  observed: {
    etag: string;
    sizeBytes: number;
    storageVersion: string | null;
    finalizedAt: string;
  },
): LargeAttachmentStorageIdentity {
  return {
    storageEtag: observed.etag,
    storageVersion: observed.storageVersion ?? "",
    sizeBytes: observed.sizeBytes,
    finalizedAt: observed.finalizedAt,
  };
}
