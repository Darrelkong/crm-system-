import { and, eq, isNull } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import { MailServiceError } from "@/lib/mail/errors";
import { assertBatchUpdateChanged, runMailBatch } from "@/lib/mail/guarded-batch";
import { LARGE_ATTACHMENT_DEDICATED_BUCKET_NAME } from "./large-attachment-constants";
import {
  addMillisecondsToIsoTimestamp,
  LARGE_ATTACHMENT_RECIPIENT_RETENTION_MS,
} from "./large-attachment-constants";
import { LARGE_ATTACHMENT_NOTICE_VERSION } from "./large-attachment-risk-acknowledgement";
import {
  evaluateLargeAttachmentSendEligibility,
  type LargeAttachmentEligibilityResult,
} from "./large-attachment-eligibility";
import {
  generateLargeAttachmentDownloadTokenPair,
} from "./large-attachment-download-token";
import {
  hasCompleteLargeAttachmentStorageIdentity,
} from "./large-attachment-storage-identity";
import { assertLargeAttachmentStorageKey } from "./large-attachment-storage-key";
import {
  transitionAcceptedSendToSent,
  type LargeAttachmentLifecycleRecord,
} from "./large-attachment-state-machine";
import {
  appendLargeAttachmentRecipientContent,
  type LargeAttachmentRecipientCard,
} from "./large-attachment-recipient-card";

export const LARGE_ATTACHMENT_SEND_ENABLED_ENV =
  "MAIL_LARGE_ATTACHMENT_SEND_ENABLED" as const;
export const LARGE_ATTACHMENT_PUBLIC_BASE_URL_ENV =
  "MAIL_LARGE_ATTACHMENT_PUBLIC_BASE_URL" as const;
export const LARGE_ATTACHMENT_SEND_DISABLED_CODE =
  "LARGE_ATTACHMENT_SEND_DISABLED" as const;
export const LARGE_ATTACHMENT_PUBLIC_BASE_URL_INVALID_CODE =
  "LARGE_ATTACHMENT_PUBLIC_BASE_URL_INVALID" as const;

type RuntimeEnvironment = Record<string, string | undefined>;

export function isLargeAttachmentSendEnabled(
  env: RuntimeEnvironment = process.env,
): boolean {
  const configured = env[LARGE_ATTACHMENT_SEND_ENABLED_ENV]
    ?.trim()
    .toLowerCase();
  return configured === "1" || configured === "true";
}

export function resolveLargeAttachmentPublicBaseUrl(
  env: RuntimeEnvironment = process.env,
): string | null {
  const configured = env[LARGE_ATTACHMENT_PUBLIC_BASE_URL_ENV]?.trim();
  if (!configured) {
    return null;
  }

  try {
    const parsed = new URL(configured);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    if (parsed.search || parsed.hash) {
      return null;
    }
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function mapLifecycleRow(
  row: typeof schema.mailLargeAttachmentLifecycle.$inferSelect,
): LargeAttachmentLifecycleRecord {
  return {
    id: row.id,
    storedFileId: row.storedFileId,
    status: row.status,
    uploadedAt: row.uploadedAt,
    temporaryExpiresAt: row.temporaryExpiresAt,
    approvalHoldStartedAt: row.approvalHoldStartedAt,
    approvalAbsoluteExpiresAt: row.approvalAbsoluteExpiresAt,
    sentAt: row.sentAt,
    recipientExpiresAt: row.recipientExpiresAt,
    deletedAt: row.deletedAt,
    deleteReason: row.deleteReason,
    downloadTokenHash: row.downloadTokenHash,
    downloadCount: row.downloadCount,
    lastDownloadedAt: row.lastDownloadedAt,
    declaredContentHash: row.declaredContentHash,
    storageVersion: row.storageVersion,
    storageEtag: row.storageEtag,
    finalizedAt: row.finalizedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function throwEligibilityFailure(
  result: LargeAttachmentEligibilityResult,
): never {
  if (result.ok) {
    throw new Error("Expected large attachment eligibility failure");
  }
  throw MailServiceError.validation(result.message, {
    issueCode: result.code,
  });
}

function assertPublicBaseUrl(baseUrl: string | null): string {
  if (!baseUrl) {
    throw MailServiceError.validation(
      "Large attachment public Gateway base URL is not configured",
      { issueCode: LARGE_ATTACHMENT_PUBLIC_BASE_URL_INVALID_CODE },
    );
  }
  return baseUrl;
}

function buildDownloadUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/f/${encodeURIComponent(token)}`;
}

type LargeAttachmentSendContext = {
  attachment: typeof schema.mailOutboundRevisionAttachments.$inferSelect;
  storedFile: typeof schema.mailStoredFiles.$inferSelect;
  lifecycle: typeof schema.mailLargeAttachmentLifecycle.$inferSelect;
};

export type PreparedLargeAttachmentRecipientToken = {
  lifecycleId: string;
  tokenHash: string;
};

async function loadAndValidateLargeAttachmentContexts(
  db: Database,
  input: {
    revisionId: string;
    authorizationMode: "admin_direct" | "staff_approved";
    trustNowIso: string;
  },
): Promise<LargeAttachmentSendContext[]> {
  const attachments = await db
    .select()
    .from(schema.mailOutboundRevisionAttachments)
    .where(eq(schema.mailOutboundRevisionAttachments.revisionId, input.revisionId))
    .orderBy(schema.mailOutboundRevisionAttachments.sortOrder);

  const largeAttachments = attachments.filter(
    (attachment) => attachment.deliveryMode === "large_attachment",
  );
  const contexts: LargeAttachmentSendContext[] = [];

  for (const attachment of largeAttachments) {
    const [storedFile] = await db
      .select()
      .from(schema.mailStoredFiles)
      .where(eq(schema.mailStoredFiles.id, attachment.storedFileId))
      .limit(1);
    const [lifecycle] = await db
      .select()
      .from(schema.mailLargeAttachmentLifecycle)
      .where(
        eq(
          schema.mailLargeAttachmentLifecycle.storedFileId,
          attachment.storedFileId,
        ),
      )
      .limit(1);

    if (!storedFile) {
      throw MailServiceError.integrityConflict(
        "Large attachment stored file is missing",
      );
    }
    if (!lifecycle) {
      throw MailServiceError.integrityConflict(
        "Large attachment lifecycle is missing",
      );
    }

    const [acknowledgement] = await db
      .select()
      .from(schema.mailLargeAttachmentAcknowledgements)
      .where(
        and(
          eq(
            schema.mailLargeAttachmentAcknowledgements.lifecycleId,
            lifecycle.id,
          ),
          eq(
            schema.mailLargeAttachmentAcknowledgements.storedFileId,
            storedFile.id,
          ),
          eq(
            schema.mailLargeAttachmentAcknowledgements.draftId,
            (
              await db
                .select({ draftId: schema.mailOutboundRevisions.sourceDraftId })
                .from(schema.mailOutboundRevisions)
                .where(eq(schema.mailOutboundRevisions.id, input.revisionId))
                .limit(1)
            )[0]?.draftId ?? "",
          ),
          eq(
            schema.mailLargeAttachmentAcknowledgements.noticeVersion,
            LARGE_ATTACHMENT_NOTICE_VERSION,
          ),
        ),
      )
      .limit(1);

    if (!acknowledgement) {
      throw MailServiceError.validation(
        "Large attachment risk acknowledgement is missing or invalid",
        { issueCode: "RISK_ACKNOWLEDGEMENT_REQUIRED" },
      );
    }

    if (
      storedFile.storageProvider !== "r2" ||
      storedFile.storageBucket !== LARGE_ATTACHMENT_DEDICATED_BUCKET_NAME ||
      lifecycle.storedFileId !== storedFile.id ||
      lifecycle.declaredContentHash !== storedFile.contentHash ||
      lifecycle.declaredContentHash !== attachment.contentHash
    ) {
      throw MailServiceError.integrityConflict(
        "Large attachment storage lineage is invalid",
      );
    }

    try {
      assertLargeAttachmentStorageKey(storedFile.storageKey);
    } catch {
      throw MailServiceError.integrityConflict(
        "Large attachment storage key is invalid",
      );
    }

    if (
      !lifecycle.storageEtag ||
      !lifecycle.finalizedAt ||
      !hasCompleteLargeAttachmentStorageIdentity({
        storageEtag: lifecycle.storageEtag,
        sizeBytes: storedFile.sizeBytes,
        finalizedAt: lifecycle.finalizedAt,
      })
    ) {
      throw MailServiceError.integrityConflict(
        "Large attachment authoritative storage identity is incomplete",
      );
    }

    const eligibility = evaluateLargeAttachmentSendEligibility({
      deliveryMode: attachment.deliveryMode,
      lifecycle: mapLifecycleRow(lifecycle),
      sizeBytes: storedFile.sizeBytes,
      securityScanStatus: storedFile.securityScanStatus,
      trustNowIso: input.trustNowIso,
      uploadFinalized: Boolean(lifecycle.finalizedAt),
      hasRiskAcknowledgement: true,
      allowApprovalHold: input.authorizationMode === "staff_approved",
      allowTemporary: input.authorizationMode === "admin_direct",
    });
    if (!eligibility.ok) {
      throwEligibilityFailure(eligibility);
    }

    contexts.push({ attachment, storedFile, lifecycle });
  }

  return contexts;
}

export async function assertLargeAttachmentSendEligible(
  db: Database,
  input: {
    revisionId: string;
    authorizationMode: "admin_direct" | "staff_approved";
    sendEnabled?: boolean;
    publicBaseUrl?: string | null;
    trustNowIso?: string;
    env?: RuntimeEnvironment;
  },
): Promise<{ hasLargeAttachments: boolean }> {
  const attachments = await db
    .select({ deliveryMode: schema.mailOutboundRevisionAttachments.deliveryMode })
    .from(schema.mailOutboundRevisionAttachments)
    .where(eq(schema.mailOutboundRevisionAttachments.revisionId, input.revisionId));
  const hasLargeAttachments = attachments.some(
    (attachment) => attachment.deliveryMode === "large_attachment",
  );
  if (!hasLargeAttachments) {
    return { hasLargeAttachments: false };
  }

  const sendEnabled =
    input.sendEnabled ?? isLargeAttachmentSendEnabled(input.env ?? process.env);
  if (!sendEnabled) {
    throw MailServiceError.validation(
      "Large attachment link delivery is disabled",
      { issueCode: LARGE_ATTACHMENT_SEND_DISABLED_CODE },
    );
  }

  assertPublicBaseUrl(
    input.publicBaseUrl ??
      resolveLargeAttachmentPublicBaseUrl(input.env ?? process.env),
  );
  await loadAndValidateLargeAttachmentContexts(db, {
    revisionId: input.revisionId,
    authorizationMode: input.authorizationMode,
    trustNowIso: input.trustNowIso ?? new Date().toISOString(),
  });
  return { hasLargeAttachments: true };
}

export async function prepareLargeAttachmentRecipientCards(
  db: Database,
  input: {
    revisionId: string;
    authorizationMode: "admin_direct" | "staff_approved";
    sentAt: string;
    sendEnabled?: boolean;
    publicBaseUrl?: string | null;
    trustNowIso?: string;
    env?: RuntimeEnvironment;
  },
): Promise<{
  cards: LargeAttachmentRecipientCard[];
  body: { bodyText: string | null; bodyHtml: string | null };
  preparedTokens: PreparedLargeAttachmentRecipientToken[];
}> {
  const eligibility = await assertLargeAttachmentSendEligible(db, input);
  if (!eligibility.hasLargeAttachments) {
    return {
      cards: [],
      body: { bodyText: null, bodyHtml: null },
      preparedTokens: [],
    };
  }
  const publicBaseUrl = assertPublicBaseUrl(
    input.publicBaseUrl ??
      resolveLargeAttachmentPublicBaseUrl(input.env ?? process.env),
  );
  const contexts = await loadAndValidateLargeAttachmentContexts(db, {
    revisionId: input.revisionId,
    authorizationMode: input.authorizationMode,
    trustNowIso: input.trustNowIso ?? input.sentAt,
  });
  const cards: LargeAttachmentRecipientCard[] = [];
  const preparedTokens: PreparedLargeAttachmentRecipientToken[] = [];

  for (const context of contexts) {
    const pair = generateLargeAttachmentDownloadTokenPair();
    const recipientExpiresAt = addMillisecondsToIsoTimestamp(
      input.sentAt,
      LARGE_ATTACHMENT_RECIPIENT_RETENTION_MS,
    );
    preparedTokens.push({
      lifecycleId: context.lifecycle.id,
      tokenHash: pair.tokenHash,
    });
    cards.push({
      attachmentId: context.attachment.id,
      filename: context.attachment.displayFilename,
      sizeBytes: context.attachment.sizeBytes,
      downloadUrl: buildDownloadUrl(publicBaseUrl, pair.token),
      recipientExpiresAt,
    });
  }

  return {
    cards,
    body: appendLargeAttachmentRecipientContent({
      bodyText: null,
      bodyHtml: null,
      cards,
    }),
    preparedTokens,
  };
}

export async function activatePreparedLargeAttachmentTokens(
  db: Database,
  input: {
    preparedTokens: PreparedLargeAttachmentRecipientToken[];
    sentAt: string;
    authorizationMode: "admin_direct" | "staff_approved";
  },
): Promise<void> {
  if (input.preparedTokens.length === 0) {
    return;
  }
  type BatchStatement = Parameters<Database["batch"]>[0][number];
  const statements: BatchStatement[] = [];
  for (const preparedToken of input.preparedTokens) {
    const [row] = await db
      .select()
      .from(schema.mailLargeAttachmentLifecycle)
      .where(
        eq(schema.mailLargeAttachmentLifecycle.id, preparedToken.lifecycleId),
      )
      .limit(1);
    if (!row || row.downloadTokenHash) {
      throw MailServiceError.integrityConflict(
        "Large attachment recipient token cannot be activated",
      );
    }
    const transitioned = transitionAcceptedSendToSent(mapLifecycleRow(row), {
      sentAt: input.sentAt,
      downloadTokenHash: preparedToken.tokenHash,
      authorizationPath: input.authorizationMode,
    });
    statements.push(
      db
      .update(schema.mailLargeAttachmentLifecycle)
      .set({
        status: transitioned.status,
        sentAt: transitioned.sentAt,
        recipientExpiresAt: transitioned.recipientExpiresAt,
        downloadTokenHash: transitioned.downloadTokenHash,
        temporaryExpiresAt: transitioned.temporaryExpiresAt,
        updatedAt: transitioned.updatedAt,
      })
      .where(
        and(
          eq(schema.mailLargeAttachmentLifecycle.id, preparedToken.lifecycleId),
          isNull(schema.mailLargeAttachmentLifecycle.downloadTokenHash),
          eq(
            schema.mailLargeAttachmentLifecycle.status,
            row.status,
          ),
        ),
      ),
    );
  }
  const results = await runMailBatch(db, statements);
  for (let index = 0; index < results.length; index += 1) {
    assertBatchUpdateChanged(
      results,
      index,
      "Large attachment lifecycle changed during send activation",
    );
  }
}

export function appendPreparedLargeAttachmentRecipientContent(input: {
  bodyText: string | null;
  bodyHtml: string | null;
  cards: LargeAttachmentRecipientCard[];
}): { bodyText: string | null; bodyHtml: string | null } {
  return appendLargeAttachmentRecipientContent(input);
}
