import type { User } from "../../../drizzle/schema/users";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";
import type { MailActorContext } from "@/lib/mail/actor-context";
import {
  hasAnyMailAdminGrant,
  hasEffectiveGlobalMailRead,
  hasEffectiveMailAccess,
  hasMailAdminGrant,
  hasMailDeliveryHealth,
  isCrmRootAdmin,
} from "@/lib/permissions/mail";

/** UI section gates for Mail Admin Center (Phase 2D-1). */
export type MailAdminCenterCapabilities = {
  /** Settings gear entry + drawer shell — independent of approvalWorkflowView. */
  canAccessMailAdminCenter: boolean;
  overview: boolean;
  accessManagement: boolean;
  notificationIdentityManagement: boolean;
  proofDiagnostics: boolean;
  senderIdentityManagement: boolean;
  signatureTemplateManagement: boolean;
  approvalReviewManagement: boolean;
  approvalWorkflowView: boolean;
  mailboxManagement: boolean;
  permissionManagement: boolean;
  deliveryHealth: boolean;
};

export type MailSessionContext = {
  user: {
    id: string;
    email: string;
    name: string;
  };
  /** Persisted mail_user_access provisioning state. */
  mailAccessEnabled: boolean;
  /** Runtime workspace/data-plane access (root admin OR provisioned). */
  effectiveMailAccessEnabled: boolean;
  /** Runtime global supervision read (root admin OR explicit global_mail_read). */
  effectiveGlobalMailRead: boolean;
  isCrmRootAdmin: boolean;
  capabilities: MailAdminCenterCapabilities;
};

export type MailWorkspaceShellMode = "full" | "admin_only" | "no_access";

const PERMISSION_MGMT_GRANTS: MailAdminPermission[] = [
  "super_admin",
  "permission_mgmt",
];

const ACCOUNT_MGMT_GRANTS: MailAdminPermission[] = [
  "super_admin",
  "account_mgmt",
];

const ADDRESS_ASSIGNMENT_GRANTS: MailAdminPermission[] = [
  "super_admin",
  "address_assignment",
];

const SIGNATURE_TEMPLATE_GRANTS: MailAdminPermission[] = [
  "super_admin",
  "signature_template",
];

const APPROVAL_REVIEW_GRANTS: MailAdminPermission[] = [
  "super_admin",
  "approval_review",
];

/** Mail Admin Center entry — Phase 2D-3.1; excludes approval-only staff workflow view. */
const MAIL_ADMIN_CENTER_ENTRY_GRANTS: MailAdminPermission[] = [
  "super_admin",
  "permission_mgmt",
  "account_mgmt",
  "address_assignment",
  "delivery_health",
  "signature_template",
];

const OVERVIEW_GRANTS: MailAdminPermission[] = [
  "super_admin",
  "permission_mgmt",
  "account_mgmt",
  "address_assignment",
  "delivery_health",
  "global_mail_read",
];

const ROOT_ADMIN_CAPABILITIES: MailAdminCenterCapabilities = {
  canAccessMailAdminCenter: true,
  overview: true,
  accessManagement: true,
  notificationIdentityManagement: true,
  proofDiagnostics: true,
  senderIdentityManagement: true,
  signatureTemplateManagement: true,
  approvalReviewManagement: true,
  approvalWorkflowView: true,
  mailboxManagement: true,
  permissionManagement: true,
  deliveryHealth: true,
};

export function buildMailAdminCenterCapabilities(
  actor: MailActorContext,
): MailAdminCenterCapabilities {
  if (isCrmRootAdmin(actor)) {
    return { ...ROOT_ADMIN_CAPABILITIES };
  }

  const permissionMgmt = hasAnyMailAdminGrant(actor, PERMISSION_MGMT_GRANTS);
  const accountMgmt = hasAnyMailAdminGrant(actor, ACCOUNT_MGMT_GRANTS);
  const addressAssignment = hasAnyMailAdminGrant(actor, ADDRESS_ASSIGNMENT_GRANTS);

  return {
    canAccessMailAdminCenter: hasAnyMailAdminGrant(
      actor,
      MAIL_ADMIN_CENTER_ENTRY_GRANTS,
    ),
    overview: hasAnyMailAdminGrant(actor, OVERVIEW_GRANTS),
    accessManagement: permissionMgmt,
    notificationIdentityManagement: permissionMgmt,
    proofDiagnostics: hasMailAdminGrant(actor, "super_admin"),
    senderIdentityManagement: addressAssignment,
    signatureTemplateManagement: hasAnyMailAdminGrant(
      actor,
      SIGNATURE_TEMPLATE_GRANTS,
    ),
    approvalReviewManagement: hasAnyMailAdminGrant(
      actor,
      APPROVAL_REVIEW_GRANTS,
    ),
    approvalWorkflowView: actor.mailAccessEnabled,
    mailboxManagement: accountMgmt,
    permissionManagement: permissionMgmt,
    deliveryHealth: hasMailDeliveryHealth(actor),
  };
}

export function buildMailSessionContext(
  user: Pick<User, "id" | "email" | "displayName">,
  actor: MailActorContext,
): MailSessionContext {
  const capabilities = buildMailAdminCenterCapabilities(actor);
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.displayName,
    },
    mailAccessEnabled: actor.mailAccessEnabled,
    effectiveMailAccessEnabled: hasEffectiveMailAccess(actor),
    effectiveGlobalMailRead: hasEffectiveGlobalMailRead(actor),
    isCrmRootAdmin: isCrmRootAdmin(actor),
    capabilities,
  };
}

export function resolveMailWorkspaceShellMode(input: {
  mailAccessEnabled: boolean;
  canAccessMailAdminCenter: boolean;
}): MailWorkspaceShellMode {
  if (input.mailAccessEnabled) {
    return "full";
  }
  if (input.canAccessMailAdminCenter) {
    return "admin_only";
  }
  return "no_access";
}

/** Admin Center navigation sections (Phase 2D-1). */
export type MailAdminCenterSectionId =
  | "overview"
  | "access"
  | "notificationIdentity"
  | "proofDiagnostics"
  | "senderIdentity"
  | "signature"
  | "approval"
  | "mailbox"
  | "sharedMailbox"
  | "permission"
  | "deliveryHealth";

const ADMIN_CENTER_SECTION_CAPABILITY: Record<
  MailAdminCenterSectionId,
  keyof MailAdminCenterCapabilities
> = {
  overview: "overview",
  access: "accessManagement",
  notificationIdentity: "notificationIdentityManagement",
  proofDiagnostics: "proofDiagnostics",
  senderIdentity: "senderIdentityManagement",
  signature: "signatureTemplateManagement",
  approval: "approvalWorkflowView",
  mailbox: "mailboxManagement",
  sharedMailbox: "mailboxManagement",
  permission: "permissionManagement",
  deliveryHealth: "deliveryHealth",
};

export const MAIL_ADMIN_CENTER_SECTION_ORDER: MailAdminCenterSectionId[] = [
  "overview",
  "access",
  "notificationIdentity",
  "proofDiagnostics",
  "senderIdentity",
  "signature",
  "approval",
  "mailbox",
  "sharedMailbox",
  "permission",
  "deliveryHealth",
];

export function getVisibleMailAdminCenterSections(
  capabilities: MailAdminCenterCapabilities,
): MailAdminCenterSectionId[] {
  return MAIL_ADMIN_CENTER_SECTION_ORDER.filter(
    (section) => capabilities[ADMIN_CENTER_SECTION_CAPABILITY[section]],
  );
}

export function canAccessMailAdminCenter(
  capabilities: MailAdminCenterCapabilities,
): boolean {
  return capabilities.canAccessMailAdminCenter;
}

export function resolveDefaultMailAdminCenterSection(
  capabilities: MailAdminCenterCapabilities,
): MailAdminCenterSectionId | null {
  return getVisibleMailAdminCenterSections(capabilities)[0] ?? null;
}

export const MAIL_ADMIN_CAPABILITY_ORDER: (keyof MailAdminCenterCapabilities)[] =
  [
    "overview",
    "accessManagement",
    "notificationIdentityManagement",
    "proofDiagnostics",
    "senderIdentityManagement",
    "signatureTemplateManagement",
    "approvalReviewManagement",
    "approvalWorkflowView",
    "mailboxManagement",
    "permissionManagement",
    "deliveryHealth",
  ];

export function listEnabledMailAdminCapabilityKeys(
  capabilities: MailAdminCenterCapabilities,
): (keyof MailAdminCenterCapabilities)[] {
  return MAIL_ADMIN_CAPABILITY_ORDER.filter((key) => capabilities[key]);
}
