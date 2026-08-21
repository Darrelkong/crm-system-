/**
 * Immutable source-entity type constants for notification semantic idempotency.
 * Wiring into business batches is Phase 2C.12B.2 — constants only here.
 */
export const MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES = {
  mailMessage: "mail_message",
  mailOutboundApprovalEvent: "mail_outbound_approval_event",
  mailSendOperation: "mail_send_operation",
  /** Reserved — shared assignment source wiring deferred. */
  mailSharedAssignment: "mail_shared_assignment",
  /** Admin-controlled Cloudflare Email Sending proof — not business mail graph. */
  mailNotificationProof: "mail_notification_proof",
} as const;

export type MailNotificationSourceEntityType =
  (typeof MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES)[keyof typeof MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES];
