import { formatHongKongDateTime } from "@/lib/timezone";
import {
  CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS,
  CLOUDFLARE_EMAIL_NOTIFICATION_FROM_DISPLAY_NAME,
} from "@/lib/mail/cloudflare-email-notification-transport-adapter";

export type NotificationVerificationEmailContent = {
  to: string;
  from: string;
  subject: string;
  text: string;
};

export function buildNotificationVerificationEmailContent(input: {
  targetEmail: string;
  verificationCode: string;
  expiresAt: string;
}): NotificationVerificationEmailContent {
  const expiresLabel = formatHongKongDateTime(input.expiresAt);
  return {
    to: input.targetEmail,
    from: `${CLOUDFLARE_EMAIL_NOTIFICATION_FROM_DISPLAY_NAME} <${CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS}>`,
    subject: "ECHFRONT CRM — Verify your notification email",
    text: [
      "ECHFRONT CRM Mail",
      "",
      "Use this verification code to confirm your private notification email:",
      "",
      input.verificationCode,
      "",
      `This code expires at ${expiresLabel}.`,
      "",
      "If you did not request this verification, you can ignore this email.",
    ].join("\n"),
  };
}
