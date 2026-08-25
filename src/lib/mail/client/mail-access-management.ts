import type { MailAdminCenterCapabilities } from "@/lib/mail/mail-session-context";

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
  status: "active" | "disabled" | "deleted";
};

export type MailAccessUserRow = {
  userId: string;
  name: string;
  email: string;
  isEnabled: boolean;
  enabledAt: string | null;
  hasAccessRecord: boolean;
  hasVerifiedNotificationIdentity: boolean;
};

export function canManageMailAccess(
  capabilities: Pick<MailAdminCenterCapabilities, "accessManagement">,
): boolean {
  return capabilities.accessManagement;
}

export function buildMailAccessUserRows(
  users: MailAccessAdminUser[],
  accessItems: MailAccessApiItem[],
): MailAccessUserRow[] {
  const accessByUserId = new Map(
    accessItems.map((item) => [item.userId, item] as const),
  );

  return users
    .filter((user) => user.status !== "deleted")
    .map((user) => {
      const access = accessByUserId.get(user.id);
      return {
        userId: user.id,
        name: user.name,
        email: user.email,
        isEnabled: access?.isEnabled === 1,
        enabledAt: access?.enabledAt ?? null,
        hasAccessRecord: access != null,
        hasVerifiedNotificationIdentity:
          access?.hasVerifiedNotificationIdentity ?? false,
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
  if (input.row.hasVerifiedNotificationIdentity) {
    return null;
  }
  return {
    kind: "missingIdentity",
    showConfigureAction:
      input.canConfigureNotificationIdentity &&
      input.selfUserId != null &&
      input.row.userId === input.selfUserId,
  };
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
      showConfigureAction:
        input.canConfigureNotificationIdentity &&
        input.selfUserId != null &&
        input.targetUserId === input.selfUserId,
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
