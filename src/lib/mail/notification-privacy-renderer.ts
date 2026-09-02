import type { MailNotificationType } from "../../../drizzle/schema/mail-notification-outbox";

export const NEW_INCOMING_NOTIFICATION_SUBJECT =
  "[ECHFRONT Mail] 您收到一封新郵件" as const;

export type NewIncomingNotificationContext = {
  mailboxAddress: string;
  senderDisplay: string;
  subject: string;
  receivedAtLocalized: string;
};

export type RenderedNotificationPayload = {
  brandName: "ECHFRONT CRM Mail";
  notificationType: MailNotificationType;
  subjectText?: string;
  bodyText: string;
};

const GENERIC_COPY: Record<MailNotificationType, string> = {
  new_incoming: "您在 CRM Mail 收到一封新郵件，請登入查看。",
  approval_returned: "您提交的郵件已退回，請登入 CRM Mail 查看。",
  shared_assigned: "CRM Mail 有一封共享郵件已指派給您，請登入查看。",
  important_send_failure:
    "CRM Mail 有一封郵件發送或投遞需要處理，請登入查看。",
};

function renderNewIncomingBody(context: NewIncomingNotificationContext): string {
  return [
    "您在 CRM Mail 收到一封新郵件。",
    "",
    "工作郵箱：",
    context.mailboxAddress,
    "",
    "寄件人：",
    context.senderDisplay,
    "",
    "主旨：",
    context.subject,
    "",
    "收件時間：",
    context.receivedAtLocalized,
    "",
    "請登入 CRM Mail 查看完整內容及附件。",
  ].join("\n");
}

/**
 * Server-owned V1 privacy-minimal notification renderer.
 * new_incoming may include mailbox/sender/subject/timestamp snapshots only.
 * Does NOT load mail body, attachment bytes, or customer CRM metadata.
 */
export function renderNotificationPayload(
  notificationType: MailNotificationType,
  newIncomingContext?: NewIncomingNotificationContext | null,
): RenderedNotificationPayload {
  if (notificationType === "new_incoming" && newIncomingContext) {
    return {
      brandName: "ECHFRONT CRM Mail",
      notificationType,
      subjectText: NEW_INCOMING_NOTIFICATION_SUBJECT,
      bodyText: renderNewIncomingBody(newIncomingContext),
    };
  }

  return {
    brandName: "ECHFRONT CRM Mail",
    notificationType,
    bodyText: GENERIC_COPY[notificationType],
  };
}
