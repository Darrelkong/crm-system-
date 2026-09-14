import {
  MAIL_ADMIN_PERMISSIONS,
  type MailAdminPermission,
} from "../../../../drizzle/schema/mail-admin-grants";
import type { MailAdminCenterCapabilities } from "@/lib/mail/mail-session-context";
import type {
  MailAccessAdminUser,
  MailAccessApiItem,
} from "@/lib/mail/client/mail-access-management";
import { resolveMailAccessLifecycleStatus } from "@/lib/mail/client/mail-access-management";

export type MailAdminGrantApiItem = {
  id: string;
  userId: string;
  permission: MailAdminPermission;
  grantedBy: string | null;
  grantedAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MailPermissionUserRow = {
  userId: string;
  name: string;
  email: string;
  crmRole: "admin" | "staff";
  mailAccessLifecycle:
    | "not_configured"
    | "prepared"
    | "disabled"
    | "enabled";
  isRootCrmAdmin: boolean;
  explicitGrantCount: number;
};

export type MailPermissionGrantRow = {
  grantId: string;
  permission: MailAdminPermission;
  grantedAt: string;
  grantedBy: string | null;
  isExplicit: true;
};

export type MailPermissionManagementFeedback =
  | { kind: "grantSuccess" }
  | { kind: "revokeSuccess" }
  | { kind: "permissionDenied" }
  | { kind: "conflict" }
  | { kind: "genericError" };

/** Display order for delegated Mail admin permissions in management UI. */
export const MAIL_PERMISSION_DISPLAY_ORDER: MailAdminPermission[] = [
  "super_admin",
  "permission_mgmt",
  "account_mgmt",
  "address_assignment",
  "signature_template",
  "approval_review",
  "delivery_health",
  "global_mail_read",
  "auto_reply",
  "audit_view",
  "domain_health",
];

export function adminGrantsPath(userId: string): string {
  return `/api/mail/access/${encodeURIComponent(userId)}/admin-grants`;
}

export function adminGrantRevokePath(grantId: string): string {
  return `/api/mail/admin-grants/${encodeURIComponent(grantId)}/revoke`;
}

export function canManageMailPermissions(
  capabilities: Pick<MailAdminCenterCapabilities, "permissionManagement">,
): boolean {
  return capabilities.permissionManagement;
}

export function canManageSuperAdminGrants(input: {
  isCrmRootAdmin: boolean;
  capabilities: Pick<MailAdminCenterCapabilities, "proofDiagnostics">;
}): boolean {
  return input.isCrmRootAdmin || input.capabilities.proofDiagnostics;
}

export function isRootCrmAdminUser(
  user: Pick<MailAccessAdminUser, "role">,
): boolean {
  return user.role === "admin";
}

export function buildMailPermissionUserRows(
  users: MailAccessAdminUser[],
  accessItems: MailAccessApiItem[],
  grantsByUserId: Map<string, MailAdminGrantApiItem[]>,
): MailPermissionUserRow[] {
  const accessByUserId = new Map(
    accessItems.map((item) => [item.userId, item] as const),
  );

  return users
    .filter((user) => user.status !== "deleted")
    .map((user) => {
      const access = accessByUserId.get(user.id);
      const grants = grantsByUserId.get(user.id) ?? [];
      const mailAccessLifecycle = resolveMailAccessLifecycleStatus({
        isEnabled: access?.isEnabled === 1,
        hasAccessRecord: access != null,
        disabledAt: access?.disabledAt ?? null,
      });
      return {
        userId: user.id,
        name: user.name,
        email: user.email,
        crmRole: (user.role === "admin" ? "admin" : "staff") as "admin" | "staff",
        mailAccessLifecycle,
        isRootCrmAdmin: isRootCrmAdminUser(user),
        explicitGrantCount: grants.length,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function buildMailPermissionGrantRows(
  grants: MailAdminGrantApiItem[],
): MailPermissionGrantRow[] {
  const active = grants.filter((grant) => grant.revokedAt === null);
  const byPermission = new Map(
    active.map((grant) => [grant.permission, grant] as const),
  );

  return MAIL_PERMISSION_DISPLAY_ORDER
    .filter((permission) => byPermission.has(permission))
    .map((permission) => {
      const grant = byPermission.get(permission)!;
      return {
        grantId: grant.id,
        permission,
        grantedAt: grant.grantedAt,
        grantedBy: grant.grantedBy,
        isExplicit: true,
      };
    });
}

export function listGrantableMailAdminPermissions(input: {
  canManageSuperAdmin: boolean;
  existingPermissions: Set<MailAdminPermission>;
  targetIsRootCrmAdmin: boolean;
}): MailAdminPermission[] {
  if (input.targetIsRootCrmAdmin) {
    return [];
  }

  return MAIL_PERMISSION_DISPLAY_ORDER.filter((permission) => {
    if (input.existingPermissions.has(permission)) {
      return false;
    }
    if (permission === "super_admin" && !input.canManageSuperAdmin) {
      return false;
    }
    return true;
  });
}

export function canRevokeMailAdminGrant(input: {
  permission: MailAdminPermission;
  targetIsRootCrmAdmin: boolean;
  canManageSuperAdmin: boolean;
}): boolean {
  if (input.targetIsRootCrmAdmin) {
    return false;
  }
  if (input.permission === "super_admin" && !input.canManageSuperAdmin) {
    return false;
  }
  return true;
}

export function resolveMailPermissionApiFeedback(input: {
  status: number;
  errorCode?: string;
}): MailPermissionManagementFeedback {
  if (input.errorCode === "FORBIDDEN" || input.status === 403) {
    return { kind: "permissionDenied" };
  }
  if (input.errorCode === "CONFLICT" || input.status === 409) {
    return { kind: "conflict" };
  }
  return { kind: "genericError" };
}

export function resolveMailPermissionListErrorFeedback(input: {
  status: number;
  errorCode?: string;
}): "permissionDenied" | "genericError" {
  if (input.errorCode === "FORBIDDEN" || input.status === 403) {
    return "permissionDenied";
  }
  return "genericError";
}

export function mailAdminPermissionLabelKey(
  permission: MailAdminPermission,
): string {
  return `mail.adminCenter.permission.grants.${permission}`;
}

export function isKnownMailAdminPermission(
  value: string,
): value is MailAdminPermission {
  return (MAIL_ADMIN_PERMISSIONS as readonly string[]).includes(value);
}
