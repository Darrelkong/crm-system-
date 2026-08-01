/** Safe server log for approval notification failures — no PII / SQL / body. */

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
