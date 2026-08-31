import type { MailDeliveryMode } from "../../../../drizzle/schema/mail-draft-attachments";
import type { MailSecurityScanStatus } from "../../../../drizzle/schema/mail-stored-files";
import { LARGE_ATTACHMENT_MAX_FILE_BYTES } from "@/lib/mail/large-attachment/large-attachment-policy";
import {
  evaluateApprovalAbsoluteExpiry,
  evaluateTemporaryExpiry,
  type LargeAttachmentLifecycleRecord,
} from "@/lib/mail/large-attachment/large-attachment-state-machine";
import {
  hasCompleteLargeAttachmentStorageIdentity,
} from "@/lib/mail/large-attachment/large-attachment-storage-identity";
import {
  isLargeAttachmentSecurityScanEligible,
  LARGE_ATTACHMENT_REQUIRED_SCAN_STATUS,
} from "@/lib/mail/large-attachment/large-attachment-security";

export type LargeAttachmentEligibilityIssueCode =
  | "NOT_LARGE_ATTACHMENT"
  | "MISSING_LIFECYCLE"
  | "NOT_FINALIZED"
  | "TEMPORARY_EXPIRED"
  | "APPROVAL_HOLD_EXPIRED"
  | "TERMINAL_STATUS"
  | "MISSING_STORED_FILE"
  | "MISSING_STORAGE_IDENTITY"
  | "STORAGE_KEY_MISMATCH"
  | "POLICY_SIZE_EXCEEDED"
  | "SECURITY_SCAN_NOT_ELIGIBLE"
  | "SESSION_INVALIDATED"
  | "SESSION_EXPIRED";

export type LargeAttachmentEligibilityResult =
  | { ok: true }
  | { ok: false; code: LargeAttachmentEligibilityIssueCode; message: string };

export function isLargeAttachmentDeliveryMode(
  deliveryMode: MailDeliveryMode | string,
): deliveryMode is "large_attachment" {
  return deliveryMode === "large_attachment";
}

export function evaluateLargeAttachmentApprovalSubmitEligibility(input: {
  deliveryMode: MailDeliveryMode;
  lifecycle: LargeAttachmentLifecycleRecord | null | undefined;
  sizeBytes: number;
  securityScanStatus: MailSecurityScanStatus;
  trustNowIso: string;
  uploadFinalized: boolean;
}): LargeAttachmentEligibilityResult {
  if (!isLargeAttachmentDeliveryMode(input.deliveryMode)) {
    return { ok: true };
  }

  if (!input.uploadFinalized) {
    return {
      ok: false,
      code: "NOT_FINALIZED",
      message: "Large attachment upload is not finalized",
    };
  }

  return evaluateLargeAttachmentSendEligibility({
    ...input,
    allowApprovalHold: true,
    allowTemporary: true,
  });
}

export function evaluateLargeAttachmentSendEligibility(input: {
  deliveryMode: MailDeliveryMode;
  lifecycle: LargeAttachmentLifecycleRecord | null | undefined;
  sizeBytes: number;
  securityScanStatus: MailSecurityScanStatus;
  trustNowIso: string;
  uploadFinalized: boolean;
  allowApprovalHold?: boolean;
  allowTemporary?: boolean;
}): LargeAttachmentEligibilityResult {
  if (!isLargeAttachmentDeliveryMode(input.deliveryMode)) {
    return { ok: true };
  }

  if (!input.lifecycle) {
    return {
      ok: false,
      code: "MISSING_LIFECYCLE",
      message: "Large attachment lifecycle metadata is missing",
    };
  }

  if (!input.uploadFinalized) {
    return {
      ok: false,
      code: "NOT_FINALIZED",
      message: "Large attachment upload is not finalized",
    };
  }

  if (input.sizeBytes > LARGE_ATTACHMENT_MAX_FILE_BYTES) {
    return {
      ok: false,
      code: "POLICY_SIZE_EXCEEDED",
      message: "Large attachment exceeds maximum file size",
    };
  }

  if (
    !isLargeAttachmentSecurityScanEligible(input.securityScanStatus)
  ) {
    return {
      ok: false,
      code: "SECURITY_SCAN_NOT_ELIGIBLE",
      message: `Large attachment requires scan status ${LARGE_ATTACHMENT_REQUIRED_SCAN_STATUS}`,
    };
  }

  const { lifecycle } = input;

  if (
    lifecycle.status === "expired" ||
    lifecycle.status === "deleted" ||
    lifecycle.status === "revoked"
  ) {
    return {
      ok: false,
      code: "TERMINAL_STATUS",
      message: `Large attachment is ${lifecycle.status}`,
    };
  }

  if (lifecycle.status === "temporary") {
    if (!input.allowTemporary) {
      return {
        ok: false,
        code: "NOT_FINALIZED",
        message: "Large attachment is not approved for send",
      };
    }
    if (evaluateTemporaryExpiry(lifecycle, input.trustNowIso)) {
      return {
        ok: false,
        code: "TEMPORARY_EXPIRED",
        message: "Large attachment temporary retention expired",
      };
    }
  }

  if (lifecycle.status === "approval_hold") {
    if (!input.allowApprovalHold) {
      return {
        ok: false,
        code: "NOT_FINALIZED",
        message: "Large attachment approval hold not cleared for send path",
      };
    }
    if (evaluateApprovalAbsoluteExpiry(lifecycle, input.trustNowIso)) {
      return {
        ok: false,
        code: "APPROVAL_HOLD_EXPIRED",
        message: "Large attachment approval retention expired",
      };
    }
  }

  if (lifecycle.status === "sent") {
    return {
      ok: false,
      code: "TERMINAL_STATUS",
      message: "Sent large attachment cannot be reused as a new outbound attachment",
    };
  }

  if (
    !lifecycle.finalizedAt ||
    !lifecycle.declaredContentHash ||
    !lifecycle.storageEtag ||
    !hasCompleteLargeAttachmentStorageIdentity({
      storageEtag: lifecycle.storageEtag,
      sizeBytes: input.sizeBytes,
      finalizedAt: lifecycle.finalizedAt,
    })
  ) {
    return {
      ok: false,
      code: "MISSING_STORAGE_IDENTITY",
      message: "Large attachment authoritative storage identity is incomplete",
    };
  }

  return { ok: true };
}
