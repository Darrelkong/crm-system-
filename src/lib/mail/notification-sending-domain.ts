/** Cloudflare Email Sending domain for CRM notification transport (frozen Phase 2). */
export const MAIL_NOTIFICATION_SENDING_DOMAIN = "send.echfronthk.com" as const;

export {
  CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS as MAIL_NOTIFICATION_SENDING_FROM_ADDRESS,
  CLOUDFLARE_EMAIL_NOTIFICATION_FROM_DISPLAY_NAME as MAIL_NOTIFICATION_SENDING_FROM_DISPLAY_NAME,
} from "@/lib/mail/cloudflare-email-notification-transport-adapter";
