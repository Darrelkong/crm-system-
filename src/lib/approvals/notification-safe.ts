/** Safe server log for approval notification side-effects — no PII / SQL / body. */

import type { Database } from "@/lib/db";
import { markApprovalPendingNotificationsRead } from "@/lib/notifications/queries";

function approvalNotificationErrorCategory(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name;
  }
  return "unknown";
}

export function logApprovalNotificationFailure(input: {
  approvalId: string;
  recipientUserId?: string;
  notificationType: string;
  error: unknown;
}): void {
  const payload: {
    approvalId: string;
    recipientUserId?: string;
    notificationType: string;
    errorCategory: string;
  } = {
    approvalId: input.approvalId,
    notificationType: input.notificationType,
    errorCategory: approvalNotificationErrorCategory(input.error),
  };
  if (input.recipientUserId != null) {
    payload.recipientUserId = input.recipientUserId;
  }
  console.error("[approval.notification]", payload);
}

export function logApprovalPendingMarkReadFailure(input: {
  approvalId: string;
  finalStatus: "approved" | "rejected";
  error: unknown;
}): void {
  console.error("[approval.notification]", {
    approvalId: input.approvalId,
    operation: "mark_pending_read",
    finalStatus: input.finalStatus,
    errorCategory: approvalNotificationErrorCategory(input.error),
  });
}

/**
 * Marks unread approval.pending notifications read for one approval.
 * Never throws — lifecycle failures must not affect Approval core success.
 */
export async function markApprovalPendingNotificationsReadSafely(
  db: Database,
  approvalId: string,
  finalStatus: "approved" | "rejected",
): Promise<void> {
  try {
    await markApprovalPendingNotificationsRead(db, approvalId);
  } catch (error) {
    logApprovalPendingMarkReadFailure({
      approvalId,
      finalStatus,
      error,
    });
  }
}
