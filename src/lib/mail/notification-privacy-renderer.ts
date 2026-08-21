import type { MailNotificationType } from "../../../drizzle/schema/mail-notification-outbox";

export type RenderedNotificationPayload = {
  brandName: "ECHFRONT CRM Mail";
  notificationType: MailNotificationType;
  bodyText: string;
};

const GENERIC_COPY: Record<MailNotificationType, string> = {
  new_incoming: "您在 CRM Mail 收到一封新郵件，請登入查看。",
  approval_returned: "您提交的郵件已退回，請登入 CRM Mail 查看。",
  shared_assigned: "CRM Mail 有一封共享郵件已指派給您，請登入查看。",
  important_send_failure:
    "CRM Mail 有一封郵件發送或投遞需要處理，請登入查看。",
};

/**
 * Server-owned V1 privacy-minimal notification renderer.
 * Does NOT load mail body, subject, sender, or customer data.
 */
export function renderNotificationPayload(
  notificationType: MailNotificationType,
): RenderedNotificationPayload {
  return {
    brandName: "ECHFRONT CRM Mail",
    notificationType,
    bodyText: GENERIC_COPY[notificationType],
  };
}
