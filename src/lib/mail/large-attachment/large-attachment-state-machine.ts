import type { MailLargeAttachmentLifecycleStatus } from "../../../../drizzle/schema/mail-large-attachment-lifecycle";
import {
  addMillisecondsToIsoTimestamp,
  isIsoTimestampBeforeOrEqual,
  LARGE_ATTACHMENT_APPROVAL_MAX_RETENTION_MS,
  LARGE_ATTACHMENT_RECIPIENT_RETENTION_MS,
  LARGE_ATTACHMENT_TEMPORARY_RETENTION_MS,
} from "@/lib/mail/large-attachment/large-attachment-constants";

export type LargeAttachmentLifecycleRecord = {
  id: string;
  storedFileId: string;
  status: MailLargeAttachmentLifecycleStatus;
  uploadedAt: string;
  temporaryExpiresAt: string | null;
  approvalHoldStartedAt: string | null;
  approvalAbsoluteExpiresAt: string | null;
  sentAt: string | null;
  recipientExpiresAt: string | null;
  deletedAt: string | null;
  deleteReason: string | null;
  downloadTokenHash: string | null;
  downloadCount: number;
  lastDownloadedAt: string | null;
  declaredContentHash: string | null;
  storageVersion: string | null;
  storageEtag: string | null;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export class LargeAttachmentStateTransitionError extends Error {
  readonly code = "INVALID_LARGE_ATTACHMENT_TRANSITION" as const;

  constructor(message: string) {
    super(message);
    this.name = "LargeAttachmentStateTransitionError";
  }
}

function assertStatus(
  record: LargeAttachmentLifecycleRecord,
  allowed: MailLargeAttachmentLifecycleStatus[],
): void {
  if (!allowed.includes(record.status)) {
    throw new LargeAttachmentStateTransitionError(
      `Invalid transition from status ${record.status}`,
    );
  }
}

function withUpdatedTimestamps(
  record: LargeAttachmentLifecycleRecord,
  updatedAt: string,
): Pick<LargeAttachmentLifecycleRecord, "updatedAt"> {
  return { updatedAt };
}

export function createTemporaryLargeAttachmentLifecycle(input: {
  id: string;
  storedFileId: string;
  uploadedAt: string;
  declaredContentHash: string;
  storageVersion: string;
  storageEtag: string;
  finalizedAt: string;
}): LargeAttachmentLifecycleRecord {
  const temporaryExpiresAt = addMillisecondsToIsoTimestamp(
    input.uploadedAt,
    LARGE_ATTACHMENT_TEMPORARY_RETENTION_MS,
  );
  return {
    id: input.id,
    storedFileId: input.storedFileId,
    status: "temporary",
    uploadedAt: input.uploadedAt,
    temporaryExpiresAt,
    approvalHoldStartedAt: null,
    approvalAbsoluteExpiresAt: null,
    sentAt: null,
    recipientExpiresAt: null,
    deletedAt: null,
    deleteReason: null,
    downloadTokenHash: null,
    downloadCount: 0,
    lastDownloadedAt: null,
    declaredContentHash: input.declaredContentHash,
    storageVersion: input.storageVersion,
    storageEtag: input.storageEtag,
    finalizedAt: input.finalizedAt,
    createdAt: input.uploadedAt,
    updatedAt: input.uploadedAt,
  };
}

/**
 * First valid staff submission moves temporary → approval_hold.
 * Resubmit/returned MUST pass the same firstSubmittedAt to preserve absolute cap.
 */
export function transitionTemporaryToApprovalHold(
  record: LargeAttachmentLifecycleRecord,
  input: { firstSubmittedAt: string; now: string },
): LargeAttachmentLifecycleRecord {
  assertStatus(record, ["temporary", "approval_hold"]);

  if (record.status === "approval_hold") {
    return {
      ...record,
      ...withUpdatedTimestamps(record, input.now),
    };
  }

  if (
    record.temporaryExpiresAt &&
    isIsoTimestampBeforeOrEqual(record.temporaryExpiresAt, input.firstSubmittedAt)
  ) {
    throw new LargeAttachmentStateTransitionError(
      "Cannot enter approval_hold after temporary expiry",
    );
  }

  const approvalAbsoluteExpiresAt = addMillisecondsToIsoTimestamp(
    input.firstSubmittedAt,
    LARGE_ATTACHMENT_APPROVAL_MAX_RETENTION_MS,
  );

  return {
    ...record,
    status: "approval_hold",
    approvalHoldStartedAt: input.firstSubmittedAt,
    approvalAbsoluteExpiresAt,
    temporaryExpiresAt: null,
    ...withUpdatedTimestamps(record, input.now),
  };
}

export function evaluateTemporaryExpiry(
  record: LargeAttachmentLifecycleRecord,
  trustNowIso: string,
): boolean {
  return (
    record.status === "temporary" &&
    record.temporaryExpiresAt !== null &&
    isIsoTimestampBeforeOrEqual(record.temporaryExpiresAt, trustNowIso)
  );
}

export function evaluateApprovalAbsoluteExpiry(
  record: LargeAttachmentLifecycleRecord,
  trustNowIso: string,
): boolean {
  return (
    record.status === "approval_hold" &&
    record.approvalAbsoluteExpiresAt !== null &&
    isIsoTimestampBeforeOrEqual(record.approvalAbsoluteExpiresAt, trustNowIso)
  );
}

export function evaluateSentRecipientExpiry(
  record: LargeAttachmentLifecycleRecord,
  trustNowIso: string,
): boolean {
  return (
    record.status === "sent" &&
    record.recipientExpiresAt !== null &&
    isIsoTimestampBeforeOrEqual(record.recipientExpiresAt, trustNowIso)
  );
}

export function transitionToExpired(
  record: LargeAttachmentLifecycleRecord,
  input: { now: string; reason: string },
): LargeAttachmentLifecycleRecord {
  assertStatus(record, ["temporary", "approval_hold", "sent"]);

  return {
    ...record,
    status: "expired",
    deletedAt: input.now,
    deleteReason: input.reason,
    ...withUpdatedTimestamps(record, input.now),
  };
}

export function transitionToDeleted(
  record: LargeAttachmentLifecycleRecord,
  input: { now: string; reason: string },
): LargeAttachmentLifecycleRecord {
  assertStatus(record, ["temporary", "approval_hold", "expired", "sent", "revoked"]);

  return {
    ...record,
    status: "deleted",
    deletedAt: input.now,
    deleteReason: input.reason,
    ...withUpdatedTimestamps(record, input.now),
  };
}

export function transitionToRevoked(
  record: LargeAttachmentLifecycleRecord,
  input: { now: string; reason: string },
): LargeAttachmentLifecycleRecord {
  assertStatus(record, ["sent"]);

  return {
    ...record,
    status: "revoked",
    deletedAt: input.now,
    deleteReason: input.reason,
    ...withUpdatedTimestamps(record, input.now),
  };
}

/**
 * Provider-accepted send boundary — admin_direct may transition from temporary;
 * staff approval path transitions from approval_hold.
 */
export function transitionAcceptedSendToSent(
  record: LargeAttachmentLifecycleRecord,
  input: {
    sentAt: string;
    downloadTokenHash: string;
    authorizationPath: "admin_direct" | "staff_approved";
  },
): LargeAttachmentLifecycleRecord {
  if (input.authorizationPath === "admin_direct") {
    assertStatus(record, ["temporary"]);
    if (evaluateTemporaryExpiry(record, input.sentAt)) {
      throw new LargeAttachmentStateTransitionError(
        "Cannot send expired temporary large attachment",
      );
    }
  } else {
    assertStatus(record, ["approval_hold"]);
    if (evaluateApprovalAbsoluteExpiry(record, input.sentAt)) {
      throw new LargeAttachmentStateTransitionError(
        "Cannot send approval_hold large attachment past absolute cap",
      );
    }
  }

  const recipientExpiresAt = addMillisecondsToIsoTimestamp(
    input.sentAt,
    LARGE_ATTACHMENT_RECIPIENT_RETENTION_MS,
  );

  return {
    ...record,
    status: "sent",
    sentAt: input.sentAt,
    recipientExpiresAt,
    downloadTokenHash: input.downloadTokenHash,
    temporaryExpiresAt: null,
    ...withUpdatedTimestamps(record, input.sentAt),
  };
}

export function assertLargeAttachmentNotTerminalForSend(
  record: LargeAttachmentLifecycleRecord,
): void {
  if (record.status === "expired" || record.status === "deleted" || record.status === "revoked") {
    throw new LargeAttachmentStateTransitionError(
      `Large attachment ${record.status} cannot be sent`,
    );
  }
}

export function assertNoBackwardTransitionToSent(
  fromStatus: MailLargeAttachmentLifecycleStatus,
): void {
  if (fromStatus === "expired" || fromStatus === "deleted" || fromStatus === "revoked") {
    throw new LargeAttachmentStateTransitionError(
      `Backward transition to sent from ${fromStatus} is forbidden`,
    );
  }
}
