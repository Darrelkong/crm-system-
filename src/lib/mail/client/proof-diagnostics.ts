import type { MailAdminCenterCapabilities } from "@/lib/mail/mail-session-context";

export type NotificationProofRunOutboxStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed_retryable"
  | "failed_permanent";

export type NotificationProofRunAttemptStatus =
  | "started"
  | "accepted"
  | "temporary_failure"
  | "permanent_failure"
  | "outcome_unknown";

export type NotificationProofRunNotificationType =
  | "new_incoming"
  | "approval_returned"
  | "shared_assigned"
  | "important_send_failure";

export type NotificationProofRunApiItem = {
  sourceEntityId: string;
  notificationType: NotificationProofRunNotificationType;
  outboxStatus: NotificationProofRunOutboxStatus;
  attemptStatus: NotificationProofRunAttemptStatus | null;
  providerId: string | null;
  createdAt: string;
  completedAt: string | null;
  attemptCompletedAt: string | null;
};

export function canViewProofDiagnostics(
  capabilities: Pick<MailAdminCenterCapabilities, "proofDiagnostics">,
): boolean {
  return capabilities.proofDiagnostics;
}

export const NOTIFICATION_PROOF_LIST_PATH =
  "/api/mail/admin/notification-proof";
