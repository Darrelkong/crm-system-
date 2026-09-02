import type { MailAdminCenterCapabilities } from "@/lib/mail/mail-session-context";
import {
  findActivePendingNotificationIdentity,
  findActiveVerifiedNotificationIdentity,
  type NotificationIdentityApiItem,
} from "@/lib/mail/client/notification-identity-management";

export type MailAccessApiItem = {
  userId: string;
  isEnabled: number;
  enabledAt: string | null;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
  hasVerifiedNotificationIdentity: boolean;
};

export type MailAccessAdminUser = {
  id: string;
  name: string;
  email: string;
  role?: "admin" | "staff";
  status: "active" | "disabled" | "deleted";
};

export type MailAccessLifecycleStatus =
  | "not_configured"
  | "prepared"
  | "disabled"
  | "enabled";

export type NotificationIdentityLifecycleStatus =
  | "none"
  | "pending"
  | "verified"
  | "replacement_pending";

export type MailAccessUserRow = {
  userId: string;
  name: string;
  email: string;
  isEnabled: boolean;
  enabledAt: string | null;
  disabledAt: string | null;
  hasAccessRecord: boolean;
  hasVerifiedNotificationIdentity: boolean;
  notificationIdentityStatus: NotificationIdentityLifecycleStatus;
  notificationIdentityEmail: string | null;
  pendingNotificationIdentityId: string | null;
  replacementPending: boolean;
};

export type MailAccessOnboardingActionKind =
  | "configureNotificationEmail"
  | "completeVerification"
  | "enableMail"
  | "disableMail"
  | "manageNotificationEmail"
  | "none";

export type MailAccessOnboardingAction = {
  kind: MailAccessOnboardingActionKind;
};

export function canManageMailAccess(
  capabilities: Pick<MailAdminCenterCapabilities, "accessManagement">,
): boolean {
  return capabilities.accessManagement;
}

function resolveNotificationIdentityLifecycle(
  items: NotificationIdentityApiItem[],
): {
  status: NotificationIdentityLifecycleStatus;
  email: string | null;
  pendingIdentityId: string | null;
  hasVerified: boolean;
  replacementPending: boolean;
} {
  const verified = findActiveVerifiedNotificationIdentity(items);
  const pending = findActivePendingNotificationIdentity(items);

  if (verified && pending) {
    const replacementPending =
      pending.email.trim().toLowerCase() !== verified.email.trim().toLowerCase();
    return {
      status: replacementPending ? "replacement_pending" : "pending",
      email: verified.email,
      pendingIdentityId: pending.id,
      hasVerified: true,
      replacementPending,
    };
  }

  if (verified) {
    return {
      status: "verified",
      email: verified.email,
      pendingIdentityId: null,
      hasVerified: true,
      replacementPending: false,
    };
  }

  if (pending) {
    return {
      status: "pending",
      email: pending.email,
      pendingIdentityId: pending.id,
      hasVerified: false,
      replacementPending: false,
    };
  }

  return {
    status: "none",
    email: null,
    pendingIdentityId: null,
    hasVerified: false,
    replacementPending: false,
  };
}

export function resolveMailAccessLifecycleStatus(
  row: Pick<
    MailAccessUserRow,
    "isEnabled" | "hasAccessRecord" | "disabledAt"
  >,
): MailAccessLifecycleStatus {
  if (row.isEnabled) {
    return "enabled";
  }
  if (!row.hasAccessRecord) {
    return "not_configured";
  }
  if (row.disabledAt) {
    return "disabled";
  }
  return "prepared";
}

export function resolveMailAccessOnboardingAction(
  row: MailAccessUserRow,
  canManage: boolean,
): MailAccessOnboardingAction {
  if (!canManage) {
    return { kind: "none" };
  }
  if (row.replacementPending && row.isEnabled) {
    return { kind: "manageNotificationEmail" };
  }
  if (row.isEnabled) {
    return { kind: "disableMail" };
  }
  return { kind: "enableMail" };
}

export function buildMailAccessUserRows(
  users: MailAccessAdminUser[],
  accessItems: MailAccessApiItem[],
  notificationIdentitiesByUserId: Map<string, NotificationIdentityApiItem[]> = new Map(),
): MailAccessUserRow[] {
  const accessByUserId = new Map(
    accessItems.map((item) => [item.userId, item] as const),
  );

  return users
    .filter((user) => user.status !== "deleted")
    .map((user) => {
      const access = accessByUserId.get(user.id);
      const identityLifecycle = resolveNotificationIdentityLifecycle(
        notificationIdentitiesByUserId.get(user.id) ?? [],
      );
      return {
        userId: user.id,
        name: user.name,
        email: user.email,
        isEnabled: access?.isEnabled === 1,
        enabledAt: access?.enabledAt ?? null,
        disabledAt: access?.disabledAt ?? null,
        hasAccessRecord: access != null,
        hasVerifiedNotificationIdentity: identityLifecycle.hasVerified,
        notificationIdentityStatus: identityLifecycle.status,
        notificationIdentityEmail: identityLifecycle.email,
        pendingNotificationIdentityId: identityLifecycle.pendingIdentityId,
        replacementPending: identityLifecycle.replacementPending,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export type MailAccessRowActions = {
  showEnable: boolean;
  showDisable: boolean;
};

export function resolveMailAccessRowActions(
  row: MailAccessUserRow,
  canManage: boolean,
): MailAccessRowActions {
  if (!canManage) {
    return { showEnable: false, showDisable: false };
  }
  if (row.isEnabled) {
    return { showEnable: false, showDisable: true };
  }
  return { showEnable: true, showDisable: false };
}

export function mailAccessEnablePath(userId: string): string {
  return `/api/mail/access/${encodeURIComponent(userId)}/enable`;
}

export function mailAccessDisablePath(userId: string): string {
  return `/api/mail/access/${encodeURIComponent(userId)}/disable`;
}

export type MailAccessEnableFeedback =
  | { kind: "success" }
  | { kind: "missingIdentity"; showConfigureAction: boolean }
  | { kind: "permissionDenied" }
  | { kind: "genericError" };

const MISSING_VERIFIED_NOTIFICATION_IDENTITY =
  /verified notification identity/i;

export function isMissingVerifiedNotificationIdentityError(input: {
  error: string;
  errorCode?: string;
}): boolean {
  return (
    input.errorCode === "CONFLICT" &&
    MISSING_VERIFIED_NOTIFICATION_IDENTITY.test(input.error)
  );
}

export function resolveMailAccessEnablePreCheck(input: {
  row: MailAccessUserRow;
  selfUserId: string | null;
  canConfigureNotificationIdentity: boolean;
}): MailAccessEnableFeedback | null {
  void input;
  return null;
}

export function resolveMailAccessEnableApiFeedback(input: {
  status: number;
  error: string;
  errorCode?: string;
  targetUserId: string;
  selfUserId: string | null;
  canConfigureNotificationIdentity: boolean;
}): MailAccessEnableFeedback {
  if (input.errorCode === "FORBIDDEN" || input.status === 403) {
    return { kind: "permissionDenied" };
  }
  if (isMissingVerifiedNotificationIdentityError(input)) {
    return {
      kind: "missingIdentity",
      showConfigureAction: input.canConfigureNotificationIdentity,
    };
  }
  return { kind: "genericError" };
}

export function resolveMailAccessListErrorFeedback(input: {
  status: number;
  errorCode?: string;
}): "permissionDenied" | "genericError" {
  if (input.errorCode === "FORBIDDEN" || input.status === 403) {
    return "permissionDenied";
  }
  return "genericError";
}
