import type { MailLargeAttachmentLifecycleStatus } from "../../../../drizzle/schema/mail-large-attachment-lifecycle";
import {
  evaluateApprovalAbsoluteExpiry,
  evaluateTemporaryExpiry,
  type LargeAttachmentLifecycleRecord,
} from "@/lib/mail/large-attachment/large-attachment-state-machine";
import { hasCompleteLargeAttachmentStorageIdentity } from "@/lib/mail/large-attachment/large-attachment-storage-identity";

export type LargeAttachmentReviewerDownloadIssueCode =
  | "MISSING_LIFECYCLE"
  | "NOT_FINALIZED"
  | "TERMINAL_STATUS"
  | "TEMPORARY_EXPIRED"
  | "APPROVAL_HOLD_EXPIRED"
  | "MISSING_STORAGE_IDENTITY";

export type LargeAttachmentReviewerDownloadEligibilityResult =
  | { ok: true }
  | {
      ok: false;
      code: LargeAttachmentReviewerDownloadIssueCode;
      message: string;
    };

const REVIEWER_ALLOWED_STATUSES = new Set<MailLargeAttachmentLifecycleStatus>([
  "temporary",
  "approval_hold",
]);

export function evaluateLargeAttachmentReviewerDownloadEligibility(input: {
  lifecycle: LargeAttachmentLifecycleRecord | null | undefined;
  sizeBytes: number;
  trustNowIso: string;
}): LargeAttachmentReviewerDownloadEligibilityResult {
  if (!input.lifecycle) {
    return {
      ok: false,
      code: "MISSING_LIFECYCLE",
      message: "Large attachment lifecycle metadata is missing",
    };
  }

  if (
    input.lifecycle.status === "expired" ||
    input.lifecycle.status === "deleted" ||
    input.lifecycle.status === "revoked" ||
    input.lifecycle.status === "sent"
  ) {
    return {
      ok: false,
      code: "TERMINAL_STATUS",
      message: `Large attachment is ${input.lifecycle.status}`,
    };
  }

  if (!REVIEWER_ALLOWED_STATUSES.has(input.lifecycle.status)) {
    return {
      ok: false,
      code: "TERMINAL_STATUS",
      message: `Large attachment status ${input.lifecycle.status} is not reviewable`,
    };
  }

  if (!input.lifecycle.finalizedAt || !input.lifecycle.declaredContentHash) {
    return {
      ok: false,
      code: "NOT_FINALIZED",
      message: "Large attachment upload is not finalized",
    };
  }

  if (
    input.lifecycle.status === "temporary" &&
    evaluateTemporaryExpiry(input.lifecycle, input.trustNowIso)
  ) {
    return {
      ok: false,
      code: "TEMPORARY_EXPIRED",
      message: "Large attachment temporary retention expired",
    };
  }

  if (
    input.lifecycle.status === "approval_hold" &&
    evaluateApprovalAbsoluteExpiry(input.lifecycle, input.trustNowIso)
  ) {
    return {
      ok: false,
      code: "APPROVAL_HOLD_EXPIRED",
      message: "Large attachment approval retention expired",
    };
  }

  if (
    !input.lifecycle.storageEtag ||
    !hasCompleteLargeAttachmentStorageIdentity({
      storageEtag: input.lifecycle.storageEtag,
      sizeBytes: input.sizeBytes,
      finalizedAt: input.lifecycle.finalizedAt,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_STORAGE_IDENTITY",
      message: "Large attachment storage identity is incomplete",
    };
  }

  return { ok: true };
}
