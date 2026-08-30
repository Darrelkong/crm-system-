import type { MailLargeAttachmentLifecycleStatus } from "../../../../drizzle/schema/mail-large-attachment-lifecycle";
import {
  assertDeclaredContentHashFormat,
  type LargeAttachmentFinalizeStorageBinding,
  type LargeAttachmentStorageIdentity,
} from "@/lib/mail/large-attachment/large-attachment-storage-identity";

/** Persistent D1 upload authorization session — crosses separate Worker requests. */
export type LargeAttachmentUploadSession = {
  id: string;
  actorUserId: string;
  draftId: string;
  mailboxId: string;
  storedFileId: string | null;
  storageKey: string;
  expectedFilename: string;
  expectedMimeType: string;
  expectedSizeBytes: number;
  maxSizeBytes: number;
  declaredContentHash: string;
  expiresAt: string;
  finalizedAt: string | null;
  invalidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Fields intentionally absent from persisted session rows. */
export type LargeAttachmentUploadSessionForbiddenPersistedFields = {
  presignedPutUrl?: never;
  signingSecret?: never;
  r2Credential?: never;
};

export type LargeAttachmentUploadFinalizeInput = {
  session: LargeAttachmentUploadSession;
  observedSizeBytes: number;
  observedStorageKey: string;
  storageIdentity: LargeAttachmentStorageIdentity;
  trustNowIso: string;
};

export type LargeAttachmentUploadFinalizeResult =
  | {
      ok: true;
      lifecycleStatus: Extract<MailLargeAttachmentLifecycleStatus, "temporary">;
      binding: LargeAttachmentFinalizeStorageBinding;
      idempotentReplay: boolean;
    }
  | { ok: false; code: string; message: string };

export function assertUploadSessionHasNoPresignedUrlPersisted(
  row: Record<string, unknown>,
): void {
  for (const forbidden of [
    "presignedPutUrl",
    "presigned_put_url",
    "signingSecret",
    "r2Credential",
  ]) {
    if (forbidden in row) {
      throw new Error(`Upload session must not persist forbidden field: ${forbidden}`);
    }
  }
}

export function evaluateLargeAttachmentUploadSessionValidity(input: {
  session: LargeAttachmentUploadSession;
  actorUserId: string;
  draftId: string;
  mailboxId: string;
  trustNowIso: string;
}): { ok: true } | { ok: false; code: string; message: string } {
  if (input.session.actorUserId !== input.actorUserId) {
    return { ok: false, code: "ACTOR_MISMATCH", message: "Upload session actor mismatch" };
  }
  if (input.session.draftId !== input.draftId) {
    return { ok: false, code: "DRAFT_MISMATCH", message: "Upload session draft mismatch" };
  }
  if (input.session.mailboxId !== input.mailboxId) {
    return { ok: false, code: "MAILBOX_MISMATCH", message: "Upload session mailbox mismatch" };
  }
  if (input.session.invalidatedAt) {
    return { ok: false, code: "SESSION_INVALIDATED", message: "Upload session invalidated" };
  }
  if (input.session.finalizedAt) {
    return { ok: false, code: "ALREADY_FINALIZED", message: "Upload session already finalized" };
  }
  if (Date.parse(input.session.expiresAt) <= Date.parse(input.trustNowIso)) {
    return { ok: false, code: "SESSION_EXPIRED", message: "Upload authorization expired" };
  }
  return { ok: true };
}

export function evaluateLargeAttachmentUploadFinalize(
  input: LargeAttachmentUploadFinalizeInput,
): LargeAttachmentUploadFinalizeResult {
  assertDeclaredContentHashFormat(input.session.declaredContentHash);

  if (input.session.invalidatedAt) {
    return { ok: false, code: "SESSION_INVALIDATED", message: "Upload session invalidated" };
  }

  if (Date.parse(input.session.expiresAt) <= Date.parse(input.trustNowIso)) {
    return { ok: false, code: "SESSION_EXPIRED", message: "Upload authorization expired" };
  }

  if (input.session.finalizedAt) {
    if (
      input.observedStorageKey === input.session.storageKey &&
      input.observedSizeBytes === input.session.expectedSizeBytes
    ) {
      return {
        ok: true,
        lifecycleStatus: "temporary",
        binding: {
          declaredContentHash: input.session.declaredContentHash,
          storageIdentity: {
            ...input.storageIdentity,
            sizeBytes: input.observedSizeBytes,
            finalizedAt: input.session.finalizedAt,
          },
        },
        idempotentReplay: true,
      };
    }
    return {
      ok: false,
      code: "FINALIZE_OBJECT_MISMATCH",
      message: "Finalized session cannot finalize a different object",
    };
  }

  if (input.observedStorageKey !== input.session.storageKey) {
    return { ok: false, code: "STORAGE_KEY_MISMATCH", message: "Observed storage key mismatch" };
  }
  if (input.observedSizeBytes <= 0) {
    return { ok: false, code: "EMPTY_OBJECT", message: "Uploaded object is empty" };
  }
  if (input.observedSizeBytes > input.session.maxSizeBytes) {
    return { ok: false, code: "SIZE_EXCEEDED", message: "Uploaded object exceeds authorized size" };
  }
  if (input.observedSizeBytes !== input.session.expectedSizeBytes) {
    return {
      ok: false,
      code: "SIZE_MISMATCH",
      message: "Uploaded object size does not match declared size",
    };
  }

  return {
    ok: true,
    lifecycleStatus: "temporary",
    binding: {
      declaredContentHash: input.session.declaredContentHash,
      storageIdentity: {
        ...input.storageIdentity,
        sizeBytes: input.observedSizeBytes,
      },
    },
    idempotentReplay: false,
  };
}

export function invalidateLargeAttachmentUploadSession(input: {
  session: LargeAttachmentUploadSession;
  invalidatedAt: string;
}): LargeAttachmentUploadSession {
  if (input.session.finalizedAt) {
    throw new Error("Cannot invalidate a finalized upload session");
  }
  return {
    ...input.session,
    invalidatedAt: input.invalidatedAt,
    updatedAt: input.invalidatedAt,
  };
}
