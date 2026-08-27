export const MAIL_AUDIT_ACTIONS = {
  mailboxCreated: "mail.mailbox.created",
  mailboxSuspended: "mail.mailbox.suspended",
  mailboxRestored: "mail.mailbox.restored",
  mailboxMemberGranted: "mail.mailbox_member.granted",
  mailboxMemberUpdated: "mail.mailbox_member.updated",
  mailboxMemberRevoked: "mail.mailbox_member.revoked",
  receivingAddressCreated: "mail.receiving_address.created",
  receivingAddressSuspended: "mail.receiving_address.suspended",
  receivingAddressRestored: "mail.receiving_address.restored",
  receivingAddressRetired: "mail.receiving_address.retired",
  receivingAddressRotated: "mail.receiving_address.rotated",
  accessPrepared: "mail.access.prepared",
  accessEnabled: "mail.access.enabled",
  accessDisabled: "mail.access.disabled",
  notificationIdentityCreated: "mail.notification_identity.created",
  notificationIdentityVerified: "mail.notification_identity.verified",
  notificationIdentityVerificationTokenIssued:
    "mail.notification_identity.verification_token_issued",
  notificationIdentityVerificationChallengeSent:
    "mail.notification_identity.verification_challenge_sent",
  notificationIdentityVerificationSendQueued:
    "mail.notification_identity.verification_send_queued",
  notificationIdentityVerificationDeliveryAccepted:
    "mail.notification_identity.verification_delivery_accepted",
  notificationIdentityVerificationDeliveryFailed:
    "mail.notification_identity.verification_delivery_failed",
  notificationIdentityRevoked: "mail.notification_identity.revoked",
  notificationIdentityDeliveryHealthChanged:
    "mail.notification_identity.delivery_health_changed",
  adminGrantGranted: "mail.admin_grant.granted",
  adminGrantRevoked: "mail.admin_grant.revoked",
  senderIdentityCreated: "mail.sender_identity.created",
  senderIdentitySuspended: "mail.sender_identity.suspended",
  senderIdentityRestored: "mail.sender_identity.restored",
  senderGrantGranted: "mail.sender_grant.granted",
  senderGrantRevoked: "mail.sender_grant.revoked",
  signatureVersionCreated: "mail.signature.version_created",
  signatureVersionActivated: "mail.signature.activated",
  draftCreated: "mail.draft.created",
  draftUpdated: "mail.draft.updated",
  draftDiscarded: "mail.draft.discarded",
  draftAttachmentAdded: "mail.draft.attachment_added",
  draftAttachmentRemoved: "mail.draft.attachment_removed",
  attachmentDownloaded: "mail.attachment.downloaded",
  revisionCreated: "mail.revision.created",
  approvalSubmitted: "mail.approval.submitted",
  approvalReturned: "mail.approval.returned",
  approvalResubmitted: "mail.approval.resubmitted",
  approvalWithdrawn: "mail.approval.withdrawn",
  approvalApproved: "mail.approval.approved",
  sendInitiated: "mail.send.initiated",
  sendDispatchStarted: "mail.send.dispatch_started",
  sendAccepted: "mail.send.accepted",
  sendTemporaryFailure: "mail.send.temporary_failure",
  sendPermanentFailure: "mail.send.permanent_failure",
  sendDispatchUncertain: "mail.send.dispatch_uncertain",
  sendRetryStarted: "mail.send.retry_started",
  sendPreflightBlocked: "mail.send.preflight_blocked",
  sendDispatchAuthorized: "mail.send.dispatch_authorized",
  transportModeObserved: "mail.transport.mode_observed",
  sentMaterialized: "mail.sent.materialized",
  inboundFallbackUpdated: "mail.inbound_fallback.updated",
  inboundProviderStaged: "mail.inbound_provider.staged",
  inboundMaterialized: "mail.inbound.materialized",
  deliveryProviderStaged: "mail.delivery_provider.staged",
  deliveryMaterialized: "mail.delivery.materialized",
  deliveryWebhookAccepted: "mail.delivery_webhook.accepted",
  deliveryWebhookRejected: "mail.delivery_webhook.rejected",
  ingestionQuarantineReplayed: "mail.ingestion.quarantine_replayed",
  ingestionProcessingRecovered: "mail.ingestion.processing_recovered",
  notificationSent: "mail.notification.sent",
  notificationPermanentlyFailed: "mail.notification.permanently_failed",
  notificationProcessingRecovered: "mail.notification.processing_recovered",
  notificationProofEnqueued: "mail.notification.proof_enqueued",
} as const;

/** V1 stable RFC Message-ID domain — server-generated, no sensitive data. */
export const MAIL_RFC_MESSAGE_ID_DOMAIN = "echfronthk.com" as const;

export const CANONICAL_CONTENT_HASH_VERSION = 1 as const;

export const MAIL_ERROR_CODES = {
  VALIDATION: "VALIDATION",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  STALE_VERSION: "STALE_VERSION",
  INTEGRITY_CONFLICT: "INTEGRITY_CONFLICT",
  RAW_PAYLOAD_NOT_AVAILABLE: "RAW_PAYLOAD_NOT_AVAILABLE",
  AMBIGUOUS_PROVIDER_STATE_REQUIRES_REVIEW:
    "AMBIGUOUS_PROVIDER_STATE_REQUIRES_REVIEW",
} as const;

export type MailErrorCode =
  (typeof MAIL_ERROR_CODES)[keyof typeof MAIL_ERROR_CODES];

export const MAIL_API_MAX_JSON_BYTES = 16_384;

/** Multipart compose attachment upload body limit (single file + form fields). */
export const MAIL_COMPOSE_ATTACHMENT_UPLOAD_MAX_BYTES =
  26 * 1024 * 1024;
