import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";
import { MailServiceError } from "@/lib/mail/errors";
import type { MailActorContext } from "@/lib/mail/actor-context";

/**
 * Mail authorization policy (frozen Phase 2C.2.1):
 *
 * - `super_admin` is a top-level Mail ADMINISTRATIVE permission. For Mail Admin
 *   management actions it implies granular admin grants (`account_mgmt`,
 *   `address_assignment`, `approval_review` once stored, etc.) without holding
 *   them separately.
 *
 * - `super_admin` does NOT imply Sender Identity send authorization. Outbound
 *   sending still requires the exact Sender Identity grant per the frozen
 *   outbound security model. Identity-layer grant checks (`assertHasSenderIdentitySendGrant`)
 *   do NOT prove mailbox can_send — future outbound services must combine both.
 *
 * - `global_mail_read` is read-only global mail visibility. It does NOT imply
 *   `account_mgmt`, `address_assignment`, or Sender Identity send permission.
 *
 * - CRM `role=admin` does NOT substitute for Mail admin grants.
 *
 * - `mail_user_access.is_enabled` must be true for all Mail management APIs.
 *
 * - Runtime Mail Admin APIs cannot bootstrap the first `super_admin`. The first
 *   super_admin requires a future controlled deployment/bootstrap operation.
 *   Only an existing active `super_admin` may grant or revoke `super_admin`.
 */

const ACCOUNT_MGMT_GRANTS: MailAdminPermission[] = [
  "super_admin",
  "account_mgmt",
];

const ADDRESS_ASSIGNMENT_GRANTS: MailAdminPermission[] = [
  "super_admin",
  "address_assignment",
];

const MAIL_ADMIN_READ_GRANTS: MailAdminPermission[] = [
  "super_admin",
  "account_mgmt",
  "address_assignment",
];

const PERMISSION_MGMT_GRANTS: MailAdminPermission[] = [
  "super_admin",
  "permission_mgmt",
];

/** Outbound Approval Review — return / approve Staff outbound mail. */
const OUTBOUND_APPROVAL_REVIEW_GRANTS: MailAdminPermission[] = [
  "super_admin",
  "approval_review",
];

export function hasMailAdminGrant(
  actor: MailActorContext,
  permission: MailAdminPermission,
): boolean {
  return actor.adminGrants.includes(permission);
}

export function hasAnyMailAdminGrant(
  actor: MailActorContext,
  permissions: MailAdminPermission[],
): boolean {
  return permissions.some((permission) => hasMailAdminGrant(actor, permission));
}

export function assertMailAccessEnabled(actor: MailActorContext): void {
  if (!actor.mailAccessEnabled) {
    throw MailServiceError.forbidden("Mail access is not enabled for this user");
  }
}

export function assertMailAccountManagement(actor: MailActorContext): void {
  assertMailAccessEnabled(actor);
  if (!hasAnyMailAdminGrant(actor, ACCOUNT_MGMT_GRANTS)) {
    throw MailServiceError.forbidden(
      "Mail account management permission required",
    );
  }
}

export function assertMailAddressAssignment(actor: MailActorContext): void {
  assertMailAccessEnabled(actor);
  if (!hasAnyMailAdminGrant(actor, ADDRESS_ASSIGNMENT_GRANTS)) {
    throw MailServiceError.forbidden(
      "Mail address assignment permission required",
    );
  }
}

/** Mailbox metadata read for address administration or account management. */
export function assertMailAdminRead(actor: MailActorContext): void {
  assertMailAccessEnabled(actor);
  if (!hasAnyMailAdminGrant(actor, MAIL_ADMIN_READ_GRANTS)) {
    throw MailServiceError.forbidden("Mail admin read permission required");
  }
}

/** Mail access, admin grants, and notification identity administration. */
export function assertMailPermissionManagement(actor: MailActorContext): void {
  assertMailAccessEnabled(actor);
  if (!hasAnyMailAdminGrant(actor, PERMISSION_MGMT_GRANTS)) {
    throw MailServiceError.forbidden(
      "Mail permission management authority required",
    );
  }
}

const SIGNATURE_TEMPLATE_GRANTS: MailAdminPermission[] = [
  "super_admin",
  "signature_template",
];

const SENDER_IDENTITY_MGMT_GRANTS: MailAdminPermission[] = [
  "super_admin",
  "address_assignment",
];

/** Sender Identity existence/configuration administration. */
export function assertMailSenderIdentityManagement(
  actor: MailActorContext,
): void {
  assertMailAccessEnabled(actor);
  if (!hasAnyMailAdminGrant(actor, SENDER_IDENTITY_MGMT_GRANTS)) {
    throw MailServiceError.forbidden(
      "Mail address assignment permission required",
    );
  }
}

/** Signature version create/activate administration. Staff may not mutate. */
export function assertMailSignatureTemplateManagement(
  actor: MailActorContext,
): void {
  assertMailAccessEnabled(actor);
  if (!hasAnyMailAdminGrant(actor, SIGNATURE_TEMPLATE_GRANTS)) {
    throw MailServiceError.forbidden(
      "Mail signature template management permission required",
    );
  }
}

/** Sender Identity outbound grant administration. */
export function assertMailSenderIdentityGrantManagement(
  actor: MailActorContext,
): void {
  assertMailSenderIdentityManagement(actor);
}

/**
 * Review Staff outbound approval workflows (return / approve).
 *
 * Requires `approval_review` OR `super_admin`. `account_mgmt`, `permission_mgmt`,
 * and `global_mail_read` do NOT imply approval review authority.
 */
export function assertMailOutboundApprovalReview(
  actor: MailActorContext,
): void {
  assertMailAccessEnabled(actor);
  if (!hasAnyMailAdminGrant(actor, OUTBOUND_APPROVAL_REVIEW_GRANTS)) {
    throw MailServiceError.forbidden(
      "Mail approval review permission required",
    );
  }
}

export function hasMailOutboundApprovalReview(actor: MailActorContext): boolean {
  return (
    actor.mailAccessEnabled &&
    hasAnyMailAdminGrant(actor, OUTBOUND_APPROVAL_REVIEW_GRANTS)
  );
}

/** Only super_admin may configure company inbound fallback routing. */
export function assertMailInboundFallbackConfigManagement(
  actor: MailActorContext,
): void {
  assertMailAccessEnabled(actor);
  if (!hasMailAdminGrant(actor, "super_admin")) {
    throw MailServiceError.forbidden(
      "Super admin authority required for inbound fallback configuration",
    );
  }
}

const DELIVERY_HEALTH_GRANTS: MailAdminPermission[] = [
  "super_admin",
  "delivery_health",
];

/** Operational delivery-health / future quarantine replay authority. */
export function assertMailDeliveryHealth(actor: MailActorContext): void {
  assertMailAccessEnabled(actor);
  if (!hasAnyMailAdminGrant(actor, DELIVERY_HEALTH_GRANTS)) {
    throw MailServiceError.forbidden("Mail delivery health permission required");
  }
}

export function hasMailDeliveryHealth(actor: MailActorContext): boolean {
  return (
    actor.mailAccessEnabled &&
    hasAnyMailAdminGrant(actor, DELIVERY_HEALTH_GRANTS)
  );
}

/** Only super_admin may assign or revoke the super_admin grant. */
export function assertSuperAdminGrantManagement(actor: MailActorContext): void {
  assertMailAccessEnabled(actor);
  if (!hasMailAdminGrant(actor, "super_admin")) {
    throw MailServiceError.forbidden(
      "Super admin authority required for this grant operation",
    );
  }
}

/** Controlled Cloudflare Email Sending notification proof enqueue — super_admin only. */
export function assertMailNotificationProofManagement(
  actor: MailActorContext,
): void {
  assertMailAccessEnabled(actor);
  if (!hasMailAdminGrant(actor, "super_admin")) {
    throw MailServiceError.forbidden(
      "Super admin authority required for notification proof enqueue",
    );
  }
}
