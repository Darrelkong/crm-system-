import { and, asc, desc, eq } from "drizzle-orm";
import type { MailOutboundRevision } from "../../../drizzle/schema/mail-outbound-revisions";
import type { MailRevisionKind } from "../../../drizzle/schema/mail-outbound-revisions";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import {
  buildCanonicalHashInputFromRevisionSemantics,
  computeOutboundRevisionContentHashV1,
} from "@/lib/mail/canonical-content-hash-v1-service";
import { assertCanComposeFromIdentityInMailbox } from "@/lib/mail/compose-authorization";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { loadDraftGraphForRevision } from "@/lib/mail/draft-service";
import {
  buildDraftVersionGuardedAuditInsert,
  isMailPostStateGuardError,
  runMailBatch,
} from "@/lib/mail/guarded-batch";
import { MailServiceError } from "@/lib/mail/errors";
import { sanitizeOptionalOutboundBodyHtml } from "@/lib/mail/outbound-body-html-sanitizer";
import {
  assertRevisionSubject,
  normalizeOutboundRecipients,
} from "@/lib/mail/outbound-recipient-validation";
import {
  toSafeOutboundRevisionAttachmentView,
  toSafeOutboundRevisionDetailView,
  toSafeOutboundRevisionRecipientView,
  toSafeOutboundRevisionView,
} from "@/lib/mail/outbound-revision-serialization";
import { materializeSignatureSnapshotForRevision } from "@/lib/mail/signature-snapshot-service";
import {
  assertEffectiveMailAccess,
  assertMailAccessEnabled,
  hasMailOutboundApprovalReview,
} from "@/lib/permissions/mail";
import { MAIL_SECURE_EXPIRY_DAYS } from "../../../drizzle/schema/mail-draft-attachments";

async function findRevisionById(
  db: Database,
  revisionId: string,
): Promise<MailOutboundRevision | null> {
  const [row] = await db
    .select()
    .from(schema.mailOutboundRevisions)
    .where(eq(schema.mailOutboundRevisions.id, revisionId))
    .limit(1);
  return row ?? null;
}

async function resolveRevisionChain(
  db: Database,
  draftId: string,
): Promise<{
  revisionChainId: string;
  revisionNumber: number;
  parentRevisionId: string | null;
}> {
  const [latest] = await db
    .select()
    .from(schema.mailOutboundRevisions)
    .where(eq(schema.mailOutboundRevisions.sourceDraftId, draftId))
    .orderBy(desc(schema.mailOutboundRevisions.revisionNumber))
    .limit(1);

  if (!latest) {
    return {
      revisionChainId: crypto.randomUUID(),
      revisionNumber: 1,
      parentRevisionId: null,
    };
  }

  return {
    revisionChainId: latest.revisionChainId,
    revisionNumber: latest.revisionNumber + 1,
    parentRevisionId: latest.id,
  };
}

async function assertOutboundRevisionReadAccess(
  db: Database,
  actor: MailActorContext,
  revision: MailOutboundRevision,
): Promise<void> {
  if (revision.createdByUserId !== actor.userId) {
    if (!hasMailOutboundApprovalReview(actor)) {
      throw MailServiceError.forbidden("Outbound revision access denied");
    }
    const [approval] = await db
      .select({ id: schema.mailOutboundApprovals.id })
      .from(schema.mailOutboundApprovals)
      .where(
        eq(schema.mailOutboundApprovals.revisionChainId, revision.revisionChainId),
      )
      .limit(1);
    if (!approval) {
      throw MailServiceError.forbidden("Outbound revision access denied");
    }
  }
}

export async function getOutboundRevision(
  db: Database,
  actor: MailActorContext,
  revisionId: string,
) {
  assertEffectiveMailAccess(actor);
  const revision = await findRevisionById(db, revisionId);
  if (!revision) {
    throw MailServiceError.notFound("Outbound revision not found");
  }
  await assertOutboundRevisionReadAccess(db, actor, revision);
  const recipients = await db
    .select()
    .from(schema.mailOutboundRevisionRecipients)
    .where(eq(schema.mailOutboundRevisionRecipients.revisionId, revision.id))
    .orderBy(asc(schema.mailOutboundRevisionRecipients.sortOrder));

  const attachmentRows = await db
    .select()
    .from(schema.mailOutboundRevisionAttachments)
    .where(eq(schema.mailOutboundRevisionAttachments.revisionId, revision.id))
    .orderBy(asc(schema.mailOutboundRevisionAttachments.sortOrder));

  const attachments = [];
  for (const attachment of attachmentRows) {
    const [storedFile] = await db
      .select({
        securityScanStatus: schema.mailStoredFiles.securityScanStatus,
      })
      .from(schema.mailStoredFiles)
      .where(eq(schema.mailStoredFiles.id, attachment.storedFileId))
      .limit(1);
    let lifecycle = null;
    if (attachment.deliveryMode === "large_attachment") {
      const [row] = await db
        .select()
        .from(schema.mailLargeAttachmentLifecycle)
        .where(eq(schema.mailLargeAttachmentLifecycle.storedFileId, attachment.storedFileId))
        .limit(1);
      lifecycle = row ?? null;
    }
    attachments.push(
      toSafeOutboundRevisionAttachmentView(attachment, storedFile, {
        lifecycle,
      }),
    );
  }

  return toSafeOutboundRevisionDetailView(
    revision,
    recipients.map(toSafeOutboundRevisionRecipientView),
    attachments,
  );
}

export async function recomputeOutboundRevisionContentHash(
  db: Database,
  revisionId: string,
): Promise<{ contentHash: string; hashVersion: number }> {
  const revision = await findRevisionById(db, revisionId);
  if (!revision) {
    throw MailServiceError.notFound("Outbound revision not found");
  }

  const recipients = await db
    .select()
    .from(schema.mailOutboundRevisionRecipients)
    .where(eq(schema.mailOutboundRevisionRecipients.revisionId, revision.id));

  const attachments = await db
    .select()
    .from(schema.mailOutboundRevisionAttachments)
    .where(eq(schema.mailOutboundRevisionAttachments.revisionId, revision.id))
    .orderBy(schema.mailOutboundRevisionAttachments.sortOrder);

  const snapshot = await db
    .select()
    .from(schema.mailSignatureSnapshots)
    .where(eq(schema.mailSignatureSnapshots.id, revision.signatureSnapshotId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!snapshot) {
    throw MailServiceError.integrityConflict("Signature snapshot missing");
  }

  const snapshotAssets = await db
    .select()
    .from(schema.mailSignatureSnapshotAssets)
    .where(
      eq(
        schema.mailSignatureSnapshotAssets.signatureSnapshotId,
        snapshot.id,
      ),
    )
    .orderBy(schema.mailSignatureSnapshotAssets.sortOrder);

  const hashInput = buildCanonicalHashInputFromRevisionSemantics({
    fromAddress: revision.fromAddress,
    fromDisplayName: revision.fromDisplayName,
    subject: revision.subject,
    bodyText: revision.bodyText,
    bodyHtmlSanitized: revision.bodyHtmlSanitized,
    sensitivity: revision.sensitivity,
    composeMode: revision.composeMode,
    recipients: recipients.map((recipient) => ({
      type: recipient.recipientType,
      address: recipient.address,
      display_name: recipient.displayName,
    })),
    signature: {
      bodyText: snapshot.bodyText,
      bodyHtmlSanitized: snapshot.bodyHtmlSanitized,
      assets: snapshotAssets.map((asset) => ({
        asset_ref: asset.assetRef,
        content_hash: asset.contentHash,
        mime_type: asset.mimeType,
        size_bytes: asset.sizeBytes,
        sort_order: asset.sortOrder,
      })),
    },
    attachments: attachments.map((attachment) => ({
      content_hash: attachment.contentHash,
      display_filename: attachment.displayFilename,
      mime_type: attachment.mimeType,
      size_bytes: attachment.sizeBytes,
      sort_order: attachment.sortOrder,
      delivery_mode: attachment.deliveryMode,
      secure_expiry_days: attachment.secureExpiryDays,
    })),
  });

  return computeOutboundRevisionContentHashV1(hashInput);
}

function assertCrmAdminForAdminDirectRevision(actor: MailActorContext): void {
  assertMailAccessEnabled(actor);
  if (actor.crmRole !== "admin") {
    throw MailServiceError.forbidden(
      "CRM admin role required for admin-direct revision",
    );
  }
}

/**
 * Internal immutable Draft→Revision freeze. `revisionKind` is server-owned —
 * callers must use explicit public entrypoints, never accept kind from client.
 */
async function createImmutableRevisionFromDraftGraph(
  db: Database,
  actor: MailActorContext,
  input: { draftId: string; expectedAutosaveVersion: number },
  revisionKind: Extract<MailRevisionKind, "staff_submit" | "admin_direct">,
) {
  const { draft, recipients, attachments } = await loadDraftGraphForRevision(
    db,
    input.draftId,
  );
  if (draft.authorUserId !== actor.userId) {
    throw MailServiceError.forbidden("Draft access denied");
  }
  if (draft.autosaveVersion !== input.expectedAutosaveVersion) {
    throw MailServiceError.staleVersion("Draft version conflict");
  }
  if (!draft.senderIdentityId || !draft.mailboxId) {
    throw MailServiceError.validation(
      "Draft must have sender identity and mailbox before revision creation",
    );
  }

  const { identity } = await assertCanComposeFromIdentityInMailbox(db, actor, {
    senderIdentityId: draft.senderIdentityId,
    mailboxId: draft.mailboxId,
  });

  const subject = assertRevisionSubject(draft.subject);
  const normalizedRecipients = normalizeOutboundRecipients(
    recipients.map((recipient) => ({
      recipientType: recipient.recipientType,
      address: recipient.address,
      displayName: recipient.displayName,
      sortOrder: recipient.sortOrder,
    })),
  );

  const bodyText = draft.bodyText ?? "";
  const bodyHtmlSanitized = sanitizeOptionalOutboundBodyHtml(draft.bodyHtml);
  if (!bodyText.trim() && !bodyHtmlSanitized) {
    throw MailServiceError.validation("Revision body content is required");
  }

  const fromAddress = identity.address;

  const snapshot = await materializeSignatureSnapshotForRevision(
    db,
    identity.id,
  );

  const revisionAttachments = [];
  for (const attachment of attachments) {
    const [stored] = await db
      .select()
      .from(schema.mailStoredFiles)
      .where(eq(schema.mailStoredFiles.id, attachment.storedFileId))
      .limit(1);
    if (!stored) {
      throw MailServiceError.notFound("Stored file not found for attachment");
    }
    if (attachment.deliveryMode === "secure_file") {
      if (
        attachment.secureExpiryDays === null ||
        !(MAIL_SECURE_EXPIRY_DAYS as readonly number[]).includes(
          attachment.secureExpiryDays,
        )
      ) {
        throw MailServiceError.validation("Invalid secure file expiry days");
      }
    }
    if (attachment.deliveryMode === "large_attachment") {
      if (attachment.secureExpiryDays !== null) {
        throw MailServiceError.validation(
          "Large attachment must not set secure expiry days",
        );
      }
    }
    revisionAttachments.push({
      id: crypto.randomUUID(),
      storedFileId: stored.id,
      contentHash: stored.contentHash,
      originalFilename: stored.originalFilename,
      displayFilename: attachment.displayFilename,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      sortOrder: attachment.sortOrder,
      deliveryMode: attachment.deliveryMode,
      secureExpiryDays:
        attachment.deliveryMode === "secure_file"
          ? attachment.secureExpiryDays
          : null,
    });
  }

  const hashInput = buildCanonicalHashInputFromRevisionSemantics({
    fromAddress,
    fromDisplayName: identity.displayName,
    subject,
    bodyText,
    bodyHtmlSanitized,
    sensitivity: draft.sensitivity,
    composeMode: draft.composeMode,
    recipients: normalizedRecipients.map((recipient) => ({
      type: recipient.recipientType,
      address: recipient.address,
      display_name: recipient.displayName,
    })),
    signature: {
      bodyText: snapshot.bodyText,
      bodyHtmlSanitized: snapshot.bodyHtmlSanitized,
      assets: snapshot.assets.map((asset) => ({
        asset_ref: asset.assetRef,
        content_hash: asset.contentHash,
        mime_type: asset.mimeType,
        size_bytes: asset.sizeBytes,
        sort_order: asset.sortOrder,
      })),
    },
    attachments: revisionAttachments.map((attachment) => ({
      content_hash: attachment.contentHash,
      display_filename: attachment.displayFilename,
      mime_type: attachment.mimeType,
      size_bytes: attachment.sizeBytes,
      sort_order: attachment.sortOrder,
      delivery_mode: attachment.deliveryMode,
      secure_expiry_days: attachment.secureExpiryDays,
    })),
  });

  const { contentHash, hashVersion } =
    computeOutboundRevisionContentHashV1(hashInput);

  const chain = await resolveRevisionChain(db, draft.id);
  const now = new Date().toISOString();
  const revisionId = crypto.randomUUID();
  const auditId = crypto.randomUUID();

  type BatchStatement = Parameters<Database["batch"]>[0][number];
  const statements: BatchStatement[] = [
    db.insert(schema.mailSignatureSnapshots).values({
      id: snapshot.snapshotId,
      senderIdentityId: snapshot.senderIdentityId,
      sourceSignatureVersionId: snapshot.sourceSignatureVersionId,
      bodyText: snapshot.bodyText,
      bodyHtmlSanitized: snapshot.bodyHtmlSanitized,
      assetRefsJson: null,
      snapshotHash: snapshot.snapshotHash,
      createdAt: now,
    }),
  ];

  for (const asset of snapshot.assets) {
    statements.push(
      db.insert(schema.mailSignatureSnapshotAssets).values({
        id: asset.id,
        signatureSnapshotId: snapshot.snapshotId,
        storedFileId: asset.storedFileId,
        contentHash: asset.contentHash,
        assetRef: asset.assetRef,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        sortOrder: asset.sortOrder,
        createdAt: now,
      }),
    );
  }

  statements.push(
    db.insert(schema.mailOutboundRevisions).values({
      id: revisionId,
      revisionChainId: chain.revisionChainId,
      revisionNumber: chain.revisionNumber,
      parentRevisionId: chain.parentRevisionId,
      sourceDraftId: draft.id,
      revisionKind,
      createdByUserId: actor.userId,
      createdAt: now,
      mailboxId: draft.mailboxId,
      senderIdentityId: identity.id,
      fromAddress,
      fromDisplayName: identity.displayName,
      subject,
      bodyText,
      bodyHtmlSanitized,
      sensitivity: draft.sensitivity,
      composeMode: draft.composeMode,
      replyToMessageId: draft.replyToMessageId,
      signatureSnapshotId: snapshot.snapshotId,
      contentHash,
      hashVersion,
      customerId: draft.customerId,
      customerAssociationType: draft.customerAssociationType,
      customerAssociatedByUserId: draft.customerAssociatedByUserId,
      customerAssociatedAt: draft.customerAssociatedAt,
    }),
  );

  for (const recipient of normalizedRecipients) {
    statements.push(
      db.insert(schema.mailOutboundRevisionRecipients).values({
        id: crypto.randomUUID(),
        revisionId,
        recipientType: recipient.recipientType,
        address: recipient.address,
        displayName: recipient.displayName,
        sortOrder: recipient.sortOrder,
        createdAt: now,
      }),
    );
  }

  for (const attachment of revisionAttachments) {
    statements.push(
      db.insert(schema.mailOutboundRevisionAttachments).values({
        id: attachment.id,
        revisionId,
        storedFileId: attachment.storedFileId,
        contentHash: attachment.contentHash,
        originalFilename: attachment.originalFilename,
        displayFilename: attachment.displayFilename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        sortOrder: attachment.sortOrder,
        deliveryMode: attachment.deliveryMode,
        secureExpiryDays: attachment.secureExpiryDays,
        createdAt: now,
      }),
    );
  }

  statements.push(
    buildDraftVersionGuardedAuditInsert(
      db,
      actor,
      {
        draftId: draft.id,
        expectedAutosaveVersion: input.expectedAutosaveVersion,
      },
      {
        auditId,
        now,
        action: MAIL_AUDIT_ACTIONS.revisionCreated,
        entityId: revisionId,
        entityType: "mail_outbound_revision",
        metadata: {
          revisionId,
          revisionKind,
          draftId: draft.id,
          senderIdentityId: identity.id,
          mailboxId: draft.mailboxId,
          recipientCount: normalizedRecipients.length,
          contentHash,
          hashVersion,
          actorUserId: actor.userId,
          composeMode: draft.composeMode,
          expectedAutosaveVersion: input.expectedAutosaveVersion,
        },
      },
    ),
  );

  try {
    await runMailBatch(db, statements);
  } catch (error) {
    if (isMailPostStateGuardError(error)) {
      throw MailServiceError.staleVersion(
        "Draft version conflict during revision freeze",
      );
    }
    throw error;
  }

  const recomputed = await recomputeOutboundRevisionContentHash(db, revisionId);
  if (recomputed.contentHash !== contentHash) {
    throw MailServiceError.integrityConflict(
      "Revision content hash mismatch after persistence",
    );
  }

  const revision = await findRevisionById(db, revisionId);
  if (!revision) {
    throw MailServiceError.integrityConflict("Revision creation failed");
  }
  return toSafeOutboundRevisionView(revision);
}

/** Staff outbound revision from Draft — server assigns revision_kind = staff_submit. */
export async function createOutboundRevisionFromDraft(
  db: Database,
  actor: MailActorContext,
  input: { draftId: string; expectedAutosaveVersion: number },
) {
  assertMailAccessEnabled(actor);
  return createImmutableRevisionFromDraftGraph(
    db,
    actor,
    input,
    "staff_submit",
  );
}

/**
 * CRM Admin own-compose direct revision — server assigns revision_kind = admin_direct.
 * Does not create Approval rows or Send operations.
 */
export async function createAdminDirectRevisionFromDraft(
  db: Database,
  actor: MailActorContext,
  input: { draftId: string; expectedAutosaveVersion: number },
) {
  assertCrmAdminForAdminDirectRevision(actor);
  return createImmutableRevisionFromDraftGraph(
    db,
    actor,
    input,
    "admin_direct",
  );
}
