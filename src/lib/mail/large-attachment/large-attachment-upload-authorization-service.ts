import { and, eq, inArray } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { assertCanComposeFromIdentityInMailbox } from "@/lib/mail/compose-authorization";
import { normalizeAttachmentFilename } from "@/lib/mail/compose-attachment-policy";
import {
  loadDraftDetail,
  requireAuthorDraft,
  resolveActorUser,
  type DraftDetailView,
} from "@/lib/mail/draft-service";
import { MailServiceError } from "@/lib/mail/errors";
import { classifyComposeAttachmentDeliveryMode } from "@/lib/mail/large-attachment/large-attachment-classifier";
import { normalizeContentMd5Base64 } from "@/lib/mail/large-attachment/large-attachment-content-md5";
import {
  LARGE_ATTACHMENT_DEDICATED_BUCKET_NAME,
  LARGE_ATTACHMENT_UPLOAD_AUTH_TTL_MS,
} from "@/lib/mail/large-attachment/large-attachment-constants";
import { LARGE_ATTACHMENT_MAX_FILE_BYTES } from "@/lib/mail/large-attachment/large-attachment-policy";
import { presignLargeAttachmentPut } from "@/lib/mail/large-attachment/large-attachment-r2-s3-client";
import {
  assertLargeAttachmentStorageKey,
  buildLargeAttachmentStorageKey,
} from "@/lib/mail/large-attachment/large-attachment-storage-key";
import { assertDeclaredContentHashFormat } from "@/lib/mail/large-attachment/large-attachment-storage-identity";
import { insertUploadSession } from "@/lib/mail/large-attachment/large-attachment-upload-repository";
import {
  evaluateLargeAttachmentUploadSessionValidity,
  type LargeAttachmentUploadSession,
} from "@/lib/mail/large-attachment/large-attachment-upload-session";

export type LargeAttachmentAuthorizeInput = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  declaredSha256: string;
  contentMd5: string;
};

export type LargeAttachmentAuthorizeResult = {
  uploadSessionId: string;
  uploadUrl: string;
  requiredHeaders: {
    "Content-Type": string;
    "Content-MD5": string;
    "If-None-Match": "*";
  };
  expiresAt: string;
  storageKey: string;
};

export type LargeAttachmentAuthorizePorts = {
  presignPut?: typeof presignLargeAttachmentPut;
  trustNow?: () => Date;
};

function mapClassifierReject(code: string): never {
  switch (code) {
    case "FILE_TOO_LARGE":
      throw MailServiceError.validation("Large attachment exceeds 100 MiB per file", {
        issueCode: code,
      });
    case "LARGE_AGGREGATE_EXCEEDED":
      throw MailServiceError.validation(
        "Large attachment aggregate would exceed 300 MiB",
        { issueCode: code },
      );
    case "TOO_MANY_ATTACHMENTS":
      throw MailServiceError.validation("Maximum attachment count reached", {
        issueCode: code,
      });
    case "UNSUPPORTED_FILE_TYPE":
      throw MailServiceError.validation("Unsupported attachment file type", {
        issueCode: code,
      });
    case "EMPTY_FILE":
      throw MailServiceError.validation("Attachment file is empty", {
        issueCode: code,
      });
    case "FILENAME_REQUIRED":
      throw MailServiceError.validation("Attachment filename is required", {
        issueCode: code,
      });
    default:
      throw MailServiceError.validation("Attachment authorization rejected", {
        issueCode: code,
      });
  }
}

async function loadExistingAttachmentsForClassification(
  db: Database,
  draftId: string,
): Promise<
  Array<{ sizeBytes: number; deliveryMode: "direct_attachment" | "large_attachment" | "secure_file" }>
> {
  const attachments = await db
    .select({
      storedFileId: schema.mailDraftAttachments.storedFileId,
      deliveryMode: schema.mailDraftAttachments.deliveryMode,
    })
    .from(schema.mailDraftAttachments)
    .where(eq(schema.mailDraftAttachments.draftId, draftId));

  if (attachments.length === 0) {
    return [];
  }

  const storedFiles = await db
    .select({
      id: schema.mailStoredFiles.id,
      sizeBytes: schema.mailStoredFiles.sizeBytes,
    })
    .from(schema.mailStoredFiles)
    .where(
      inArray(
        schema.mailStoredFiles.id,
        attachments.map((attachment) => attachment.storedFileId),
      ),
    );
  const sizeById = new Map(storedFiles.map((file) => [file.id, file.sizeBytes]));

  return attachments.map((attachment) => ({
    sizeBytes: sizeById.get(attachment.storedFileId) ?? 0,
    deliveryMode: attachment.deliveryMode,
  }));
}

export async function authorizeLargeAttachmentUpload(
  db: Database,
  actor: MailActorContext,
  input: {
    draftId: string;
    authorize: LargeAttachmentAuthorizeInput;
    ports?: LargeAttachmentAuthorizePorts;
  },
): Promise<LargeAttachmentAuthorizeResult> {
  const draft = await requireAuthorDraft(db, actor, input.draftId);
  if (!draft.mailboxId || !draft.senderIdentityId) {
    throw MailServiceError.validation(
      "Draft From selection is required before large attachment upload",
    );
  }

  await assertCanComposeFromIdentityInMailbox(db, actor, {
    mailboxId: draft.mailboxId,
    senderIdentityId: draft.senderIdentityId,
  });

  const filename = normalizeAttachmentFilename(input.authorize.filename);
  const mimeType =
    input.authorize.mimeType.trim().toLowerCase() || "application/octet-stream";
  const sizeBytes = input.authorize.sizeBytes;

  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw MailServiceError.validation("Attachment size must be a positive integer");
  }

  try {
    assertDeclaredContentHashFormat(input.authorize.declaredSha256);
  } catch {
    throw MailServiceError.validation("Invalid declared SHA-256 fingerprint format");
  }

  let contentMd5Base64: string;
  try {
    contentMd5Base64 = normalizeContentMd5Base64(input.authorize.contentMd5);
  } catch {
    throw MailServiceError.validation("Invalid Content-MD5 format");
  }

  const existingAttachments = await loadExistingAttachmentsForClassification(
    db,
    draft.id,
  );
  const classification = classifyComposeAttachmentDeliveryMode({
    filename,
    mimeType,
    sizeBytes,
    existingAttachments,
  });
  if (!classification.ok) {
    mapClassifierReject(classification.code);
  }
  if (classification.deliveryMode !== "large_attachment") {
    throw MailServiceError.validation(
      "File fits direct attachment budget — use standard attachment upload",
      { issueCode: "SHOULD_USE_DIRECT_ATTACHMENT" },
    );
  }

  const trustNow = input.ports?.trustNow?.() ?? new Date();
  const nowIso = trustNow.toISOString();
  const expiresAt = new Date(
    trustNow.getTime() + LARGE_ATTACHMENT_UPLOAD_AUTH_TTL_MS,
  ).toISOString();
  const sessionId = crypto.randomUUID();
  const storageKey = buildLargeAttachmentStorageKey({ uploadedAt: trustNow });
  assertLargeAttachmentStorageKey(storageKey);

  await insertUploadSession(db, {
    id: sessionId,
    actorUserId: actor.userId,
    draftId: draft.id,
    mailboxId: draft.mailboxId,
    storageKey,
    expectedFilename: filename,
    expectedMimeType: mimeType,
    expectedSizeBytes: sizeBytes,
    maxSizeBytes: LARGE_ATTACHMENT_MAX_FILE_BYTES,
    declaredContentHash: input.authorize.declaredSha256,
    expiresAt,
    createdAt: nowIso,
  });

  const presign = input.ports?.presignPut ?? presignLargeAttachmentPut;
  const presigned = await presign({
    storageKey,
    contentType: mimeType,
    contentMd5Base64,
    expiresInSeconds: Math.floor(LARGE_ATTACHMENT_UPLOAD_AUTH_TTL_MS / 1000),
  });

  return {
    uploadSessionId: sessionId,
    uploadUrl: presigned.uploadUrl,
    requiredHeaders: presigned.requiredHeaders,
    expiresAt,
    storageKey,
  };
}

export function assertAuthorizeResponseHasNoSecrets(
  result: LargeAttachmentAuthorizeResult,
): void {
  if (!result.uploadUrl.startsWith("https://")) {
    throw new Error("Upload URL must be HTTPS presigned PUT");
  }
  if (result.storageKey.includes("@")) {
    throw new Error("Storage key must not contain PII");
  }
  if (result.requiredHeaders["Content-MD5"].length === 0) {
    throw new Error("Content-MD5 header is required");
  }
}

export async function assertDraftAuthorizedForLargeAttachmentSession(
  db: Database,
  actor: MailActorContext,
  input: {
    draftId: string;
    session: LargeAttachmentUploadSession;
    trustNowIso: string;
  },
): Promise<void> {
  await requireAuthorDraft(db, actor, input.draftId);
  const validity = evaluateLargeAttachmentUploadSessionValidity({
    session: input.session,
    actorUserId: actor.userId,
    draftId: input.draftId,
    mailboxId: input.session.mailboxId,
    trustNowIso: input.trustNowIso,
  });
  if (!validity.ok && validity.code !== "ALREADY_FINALIZED") {
    throw MailServiceError.validation(validity.message, { issueCode: validity.code });
  }
}

export async function loadDraftDetailForActor(
  db: Database,
  actor: MailActorContext,
  draftId: string,
): Promise<DraftDetailView> {
  const draft = await requireAuthorDraft(db, actor, draftId);
  const user = await resolveActorUser(actor);
  return loadDraftDetail(db, draft, user);
}

export const LARGE_ATTACHMENT_AUTHORIZE_BUCKET = LARGE_ATTACHMENT_DEDICATED_BUCKET_NAME;
