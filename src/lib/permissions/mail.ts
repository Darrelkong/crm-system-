import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";
import { MailServiceError } from "@/lib/mail/errors";
import type { MailActorContext } from "@/lib/mail/actor-context";

/**
 * Mail authorization policy (Phase 2H-6G root admin supervision):
 *
 * CRM root administrator (`users.role = admin`):
 *   - Full Mail control plane (no mail_user_access prerequisite).
 *   - Effective Mail data access + effective global supervision read (derived, not persisted).
 *   - Does NOT automatically receive Sender Identity canSend or mailbox membership rows.
 *
 * Delegated Mail admin (explicit Mail admin grants, non-root):
 *   - Control plane per grant scope only.
 *   - No automatic Mail data access or global read unless separately granted.
 *
 * Ordinary Staff:
 *   - Requires provisioned `mail_user_access.is_enabled` for data plane.
 *
 * - `super_admin` Mail grant implies granular admin grants for delegated admins.
 * - `super_admin` does NOT imply Sender Identity send authorization.
 * - `global_mail_read` is explicit read-only global visibility for delegated auditors.
 * - READ / SUPERVISE ≠ SEND AS.
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

/** Outbound Approval Review — return / approve Staff outbound mail (workflow plane). */
const OUTBOUND_APPROVAL_REVIEW_GRANTS: MailAdminPermission[] = [
  "super_admin",
  "approval_review",
];

const SIGNATURE_TEMPLATE_GRANTS: MailAdminPermission[] = [
  "super_admin",
  "signature_template",
];

const SENDER_IDENTITY_MGMT_GRANTS: MailAdminPermission[] = [
  "super_admin",
  "address_assignment",
];

const DELIVERY_HEALTH_GRANTS: MailAdminPermission[] = [
  "super_admin",
  "delivery_health",
];

/** Canonical highest CRM administrator — `users.role = admin`. */
export function isCrmRootAdmin(actor: MailActorContext): boolean {
  return actor.crmRole === "admin";
}

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

/** Control-plane authority: CRM root admin OR explicit Mail admin grant set. */
export function hasMailControlPlaneAuthority(
  actor: MailActorContext,
  grants: MailAdminPermission[],
): boolean {
  if (isCrmRootAdmin(actor)) {
    return true;
  }
  return hasAnyMailAdminGrant(actor, grants);
}

/** Super-admin control-plane operations (proof, inbound fallback, super_admin grant). */
export function hasMailSuperAdminControlPlaneAuthority(
  actor: MailActorContext,
): boolean {
  return isCrmRootAdmin(actor) || hasMailAdminGrant(actor, "super_admin");
}

export function assertMailControlPlaneAuthority(
  actor: MailActorContext,
  grants: MailAdminPermission[],
  message: string,
): void {
  if (!hasMailControlPlaneAuthority(actor, grants)) {
    throw MailServiceError.forbidden(message);
  }
}

function assertMailSuperAdminControlPlaneAuthority(actor: MailActorContext): void {
  if (!hasMailSuperAdminControlPlaneAuthority(actor)) {
    throw MailServiceError.forbidden(
      "Super admin authority required for this Mail control-plane operation",
    );
  }
}

/** Persisted provisioning gate — stored mail_user_access only. */
export function assertMailAccessEnabled(actor: MailActorContext): void {
  if (!actor.mailAccessEnabled) {
    throw MailServiceError.forbidden("Mail access is not enabled for this user");
  }
}

/** Persisted mail_user_access.is_enabled = 1 — required for compose/send (all actors). */
export function hasEnabledMailUserAccess(actor: MailActorContext): boolean {
  return actor.mailAccessEnabled;
}

export function assertEnabledMailUserAccess(actor: MailActorContext): void {
  assertMailAccessEnabled(actor);
}

/** Effective Mail workspace / data-plane entry (root admin OR provisioned access). */
export function hasEffectiveMailAccess(actor: MailActorContext): boolean {
  return isCrmRootAdmin(actor) || actor.mailAccessEnabled;
}

export type PersonalMailboxOwnerEligibilityInput = {
  userStatus: "active" | "disabled" | "deleted";
};

/**
 * Personal mailbox owner assignment (control plane):
 * any active CRM account may own a Personal Mailbox.
 * Does NOT require Mail User Access and does NOT grant Sender Identity send authorization.
 */
export function isEligiblePersonalMailboxOwner(
  input: PersonalMailboxOwnerEligibilityInput,
): boolean {
  return input.userStatus === "active";
}

/** Effective company-wide supervision read (root admin OR explicit global_mail_read). */
export function hasEffectiveGlobalMailRead(actor: MailActorContext): boolean {
  return isCrmRootAdmin(actor) || hasMailAdminGrant(actor, "global_mail_read");
}

export function assertEffectiveMailAccess(actor: MailActorContext): void {
  if (!hasEffectiveMailAccess(actor)) {
    throw MailServiceError.forbidden("Mail access is not enabled for this user");
  }
}

export function assertMailAccountManagement(actor: MailActorContext): void {
  assertMailControlPlaneAuthority(
    actor,
    ACCOUNT_MGMT_GRANTS,
    "Mail account management permission required",
  );
}

export function assertMailAddressAssignment(actor: MailActorContext): void {
  assertMailControlPlaneAuthority(
    actor,
    ADDRESS_ASSIGNMENT_GRANTS,
    "Mail address assignment permission required",
  );
}

/** Mailbox metadata read for address administration or account management. */
export function assertMailAdminRead(actor: MailActorContext): void {
  assertMailControlPlaneAuthority(
    actor,
    MAIL_ADMIN_READ_GRANTS,
    "Mail admin read permission required",
  );
}

/** Mail access, admin grants, and notification identity administration. */
export function assertMailPermissionManagement(actor: MailActorContext): void {
  assertMailControlPlaneAuthority(
    actor,
    PERMISSION_MGMT_GRANTS,
    "Mail permission management authority required",
  );
}

/**
 * Notification identity target access:
 * - admins with permission_mgmt may manage any eligible user
 * - mail-enabled users may manage only their own notification identity
 */
export function assertNotificationIdentityTargetAccess(
  actor: MailActorContext,
  targetUserId: string,
): void {
  if (actor.userId === targetUserId) {
    return;
  }
  assertMailPermissionManagement(actor);
}

/** Sender Identity existence/configuration administration. */
export function assertMailSenderIdentityManagement(
  actor: MailActorContext,
): void {
  assertMailControlPlaneAuthority(
    actor,
    SENDER_IDENTITY_MGMT_GRANTS,
    "Mail address assignment permission required",
  );
}

/** Signature version create/activate administration. Staff may not mutate. */
export function assertMailSignatureTemplateManagement(
  actor: MailActorContext,
): void {
  assertMailControlPlaneAuthority(
    actor,
    SIGNATURE_TEMPLATE_GRANTS,
    "Mail signature template management permission required",
  );
}

/** Sender Identity outbound grant administration. */
export function assertMailSenderIdentityGrantManagement(
  actor: MailActorContext,
): void {
  assertMailSenderIdentityManagement(actor);
}

/**
 * Review Staff outbound approval workflows (return / approve).
 * Workflow plane — requires data access plus approval_review grant.
 */
export function assertMailOutboundApprovalReview(
  actor: MailActorContext,
): void {
  assertEffectiveMailAccess(actor);
  if (
    !isCrmRootAdmin(actor) &&
    !hasAnyMailAdminGrant(actor, OUTBOUND_APPROVAL_REVIEW_GRANTS)
  ) {
    throw MailServiceError.forbidden(
      "Mail approval review permission required",
    );
  }
}

export function hasMailOutboundApprovalReview(actor: MailActorContext): boolean {
  return (
    hasEffectiveMailAccess(actor) &&
    (isCrmRootAdmin(actor) ||
      hasAnyMailAdminGrant(actor, OUTBOUND_APPROVAL_REVIEW_GRANTS))
  );
}

/** Only super_admin (or CRM root admin bootstrap) may configure inbound fallback. */
export function assertMailInboundFallbackConfigManagement(
  actor: MailActorContext,
): void {
  assertMailSuperAdminControlPlaneAuthority(actor);
}

/** Operational delivery-health / quarantine replay authority. */
export function assertMailDeliveryHealth(actor: MailActorContext): void {
  assertMailControlPlaneAuthority(
    actor,
    DELIVERY_HEALTH_GRANTS,
    "Mail delivery health permission required",
  );
}

export function hasMailDeliveryHealth(actor: MailActorContext): boolean {
  return hasMailControlPlaneAuthority(actor, DELIVERY_HEALTH_GRANTS);
}

/** Only super_admin (or CRM root admin) may assign or revoke the super_admin grant. */
export function assertSuperAdminGrantManagement(actor: MailActorContext): void {
  assertMailSuperAdminControlPlaneAuthority(actor);
}

/** Controlled notification proof enqueue — super_admin control plane only. */
export function assertMailNotificationProofManagement(
  actor: MailActorContext,
): void {
  assertMailSuperAdminControlPlaneAuthority(actor);
}
