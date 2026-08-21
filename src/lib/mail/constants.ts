export const MAIL_AUDIT_ACTIONS = {
  mailboxCreated: "mail.mailbox.created",
  mailboxSuspended: "mail.mailbox.suspended",
  mailboxRestored: "mail.mailbox.restored",
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
  sendRetryStarted: "mail.send.retry_started",
  sentMaterialized: "mail.sent.materialized",
  inboundFallbackUpdated: "mail.inbound_fallback.updated",
  inboundProviderStaged: "mail.inbound_provider.staged",
  inboundMaterialized: "mail.inbound.materialized",
  deliveryProviderStaged: "mail.delivery_provider.staged",
  deliveryMaterialized: "mail.delivery.materialized",
  ingestionQuarantineReplayed: "mail.ingestion.quarantine_replayed",
  ingestionProcessingRecovered: "mail.ingestion.processing_recovered",
  notificationSent: "mail.notification.sent",
  notificationPermanentlyFailed: "mail.notification.permanently_failed",
  notificationProcessingRecovered: "mail.notification.processing_recovered",
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
} as const;

export type MailErrorCode =
  (typeof MAIL_ERROR_CODES)[keyof typeof MAIL_ERROR_CODES];

export const MAIL_API_MAX_JSON_BYTES = 16_384;
