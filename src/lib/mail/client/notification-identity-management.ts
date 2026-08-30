import type { MailAdminCenterCapabilities } from "@/lib/mail/mail-session-context";

export type NotificationIdentityVerificationStatus =
  | "pending"
  | "verified"
  | "revoked";

export type NotificationIdentityDeliveryHealth =
  | "unknown"
  | "healthy"
  | "temporary_problem"
  | "bounced";

/** Admin-safe notification identity view from API (no secrets). */
export type NotificationIdentityApiItem = {
  id: string;
  userId: string;
  email: string;
  verificationStatus: NotificationIdentityVerificationStatus;
  verificationRequestedAt: string | null;
  verificationExpiresAt: string | null;
  verificationAttemptCount: number;
  verifiedAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
  deliveryHealth: NotificationIdentityDeliveryHealth;
  deliveryProblemAt: string | null;
  lastDeliveryStatus: string | null;
  lastDeliveryAt: string | null;
  createdAt: string;
  updatedAt: string;
  verificationPending: boolean;
};

export type NotificationIdentityDisplayStatus =
  | "pending"
  | "verified"
  | "revoked"
  | "bounced";

export type NotificationIdentityManagementActions = {
  showAddEmail: boolean;
  showIssueToken: boolean;
  /** @deprecated Use resolveNotificationIdentitySurfaceActions().showCompleteVerification */
  showVerify: boolean;
};

export type NotificationIdentityStateModel = {
  verified: NotificationIdentityApiItem | null;
  pending: NotificationIdentityApiItem | null;
};

export type NotificationIdentitySurfaceActions = {
  showConfigureEmail: boolean;
  showChangeEmail: boolean;
  showCompleteVerification: boolean;
  showResendVerification: boolean;
};

export type NotificationIdentityTeamOverviewStatusFilter =
  | "all"
  | "verified"
  | "pending"
  | "none";

export type NotificationIdentityTeamOverviewRow = {
  userId: string;
  name: string;
  email: string;
  mailAccessEnabled: boolean;
  verifiedEmail: string | null;
  verifiedAt: string | null;
  pendingEmail: string | null;
  pendingIdentityId: string | null;
  hasVerified: boolean;
  hasPending: boolean;
  replacementPending: boolean;
  filterStatus: "none" | "pending" | "verified";
};

export type NotificationIdentityTeamOverviewRowActions = {
  showManage: boolean;
  showConfigure: boolean;
  showCompleteVerification: boolean;
  showResendVerification: boolean;
};

export type NotificationIdentityTeamOverviewUser = {
  id: string;
  name: string;
  email: string;
  status: "active" | "disabled" | "deleted";
};

export type NotificationIdentityTeamOverviewAccessItem = {
  userId: string;
  isEnabled: number;
};

export function isActiveCrmTeamMember(
  user: Pick<NotificationIdentityTeamOverviewUser, "status">,
): boolean {
  return user.status === "active";
}

export function resolveNotificationIdentityTeamOverviewRow(
  user: Pick<NotificationIdentityTeamOverviewUser, "id" | "name" | "email">,
  mailAccessEnabled: boolean,
  items: NotificationIdentityApiItem[],
): NotificationIdentityTeamOverviewRow {
  const state = resolveNotificationIdentityStateModel(items);
  const verified = state.verified;
  const pending = state.pending;
  const hasVerified = verified != null;
  const hasPending = pending != null;
  const replacementPending =
    hasVerified &&
    hasPending &&
    pending.email.trim().toLowerCase() !== verified.email.trim().toLowerCase();

  let filterStatus: NotificationIdentityTeamOverviewRow["filterStatus"] = "none";
  if (hasPending) {
    filterStatus = "pending";
  } else if (hasVerified) {
    filterStatus = "verified";
  }

  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    mailAccessEnabled,
    verifiedEmail: verified?.email ?? null,
    verifiedAt: verified?.verifiedAt ?? null,
    pendingEmail: pending?.email ?? null,
    pendingIdentityId: pending?.id ?? null,
    hasVerified,
    hasPending,
    replacementPending,
    filterStatus,
  };
}

export function buildNotificationIdentityTeamOverviewRows(
  users: NotificationIdentityTeamOverviewUser[],
  accessItems: NotificationIdentityTeamOverviewAccessItem[],
  notificationIdentitiesByUserId: Map<string, NotificationIdentityApiItem[]> = new Map(),
): NotificationIdentityTeamOverviewRow[] {
  const accessByUserId = new Map(
    accessItems.map((item) => [item.userId, item] as const),
  );

  return users
    .filter(isActiveCrmTeamMember)
    .map((user) => {
      const access = accessByUserId.get(user.id);
      return resolveNotificationIdentityTeamOverviewRow(
        user,
        access?.isEnabled === 1,
        notificationIdentitiesByUserId.get(user.id) ?? [],
      );
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function filterNotificationIdentityTeamOverviewRows(
  rows: NotificationIdentityTeamOverviewRow[],
  query: string,
  statusFilter: NotificationIdentityTeamOverviewStatusFilter,
): NotificationIdentityTeamOverviewRow[] {
  const normalizedQuery = query.trim().toLowerCase();

  return rows.filter((row) => {
    if (statusFilter === "none" && row.filterStatus !== "none") {
      return false;
    }
    if (statusFilter === "pending" && !row.hasPending) {
      return false;
    }
    if (statusFilter === "verified" && !row.hasVerified) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return (
      row.name.toLowerCase().includes(normalizedQuery) ||
      row.email.toLowerCase().includes(normalizedQuery) ||
      (row.verifiedEmail?.toLowerCase().includes(normalizedQuery) ?? false) ||
      (row.pendingEmail?.toLowerCase().includes(normalizedQuery) ?? false)
    );
  });
}

export function resolveNotificationIdentityTeamOverviewRowActions(
  row: NotificationIdentityTeamOverviewRow,
): NotificationIdentityTeamOverviewRowActions {
  if (row.filterStatus === "none") {
    return {
      showManage: true,
      showConfigure: true,
      showCompleteVerification: false,
      showResendVerification: false,
    };
  }

  if (row.hasPending) {
    return {
      showManage: true,
      showConfigure: false,
      showCompleteVerification: true,
      showResendVerification: true,
    };
  }

  return {
    showManage: true,
    showConfigure: false,
    showCompleteVerification: false,
    showResendVerification: false,
  };
}

export type NotificationIdentityTeamOverviewPrimaryAction =
  | "manage"
  | "configure"
  | "completeVerification";

export function resolveNotificationIdentityTeamOverviewPrimaryAction(
  row: NotificationIdentityTeamOverviewRow,
): NotificationIdentityTeamOverviewPrimaryAction {
  if (row.filterStatus === "none") {
    return "configure";
  }
  if (row.hasPending) {
    return "completeVerification";
  }
  return "manage";
}

export function resolveNotificationIdentityStateModel(
  items: NotificationIdentityApiItem[],
): NotificationIdentityStateModel {
  return {
    verified: findActiveVerifiedNotificationIdentity(items),
    pending: findActivePendingNotificationIdentity(items),
  };
}

export function resolveNotificationIdentitySurfaceActions(
  state: NotificationIdentityStateModel,
): NotificationIdentitySurfaceActions {
  const { verified, pending } = state;

  if (!verified && !pending) {
    return {
      showConfigureEmail: true,
      showChangeEmail: false,
      showCompleteVerification: false,
      showResendVerification: false,
    };
  }

  if (verified && !pending) {
    return {
      showConfigureEmail: false,
      showChangeEmail: true,
      showCompleteVerification: false,
      showResendVerification: false,
    };
  }

  if (pending) {
    const replacementPending =
      !verified ||
      pending.email.trim().toLowerCase() !== verified.email.trim().toLowerCase();
    return {
      showConfigureEmail: false,
      showChangeEmail: verified != null && !replacementPending,
      showCompleteVerification: true,
      showResendVerification: true,
    };
  }

  return {
    showConfigureEmail: false,
    showChangeEmail: true,
    showCompleteVerification: false,
    showResendVerification: false,
  };
}

export function shouldRenderDuplicatePrimaryIdentitySummary(
  items: NotificationIdentityApiItem[],
): boolean {
  const state = resolveNotificationIdentityStateModel(items);
  if (state.verified && state.pending) {
    return state.pending.email.trim().toLowerCase() !==
      state.verified.email.trim().toLowerCase();
  }
  return Boolean(state.verified ?? state.pending);
}

export function canManageNotificationIdentity(
  capabilities: Pick<
    MailAdminCenterCapabilities,
    "notificationIdentityManagement"
  >,
): boolean {
  return capabilities.notificationIdentityManagement;
}

export function canIssueSelfVerificationToken(
  capabilities: Pick<MailAdminCenterCapabilities, "proofDiagnostics">,
): boolean {
  return capabilities.proofDiagnostics;
}

export function filterSelfNotificationIdentities(
  items: NotificationIdentityApiItem[],
  selfUserId: string,
): NotificationIdentityApiItem[] {
  return items.filter((item) => item.userId === selfUserId);
}

export function isActiveNotificationIdentity(
  item: NotificationIdentityApiItem,
): boolean {
  return item.revokedAt == null && item.verificationStatus !== "revoked";
}

export function findActiveVerifiedNotificationIdentity(
  items: NotificationIdentityApiItem[],
): NotificationIdentityApiItem | null {
  return (
    items.find(
      (item) =>
        isActiveNotificationIdentity(item) &&
        item.verificationStatus === "verified",
    ) ?? null
  );
}

export function findActivePendingNotificationIdentity(
  items: NotificationIdentityApiItem[],
): NotificationIdentityApiItem | null {
  return (
    items.find(
      (item) =>
        isActiveNotificationIdentity(item) &&
        item.verificationStatus === "pending",
    ) ?? null
  );
}

export function resolveNotificationIdentityDisplayStatus(
  item: NotificationIdentityApiItem,
): NotificationIdentityDisplayStatus {
  if (item.revokedAt != null || item.verificationStatus === "revoked") {
    return "revoked";
  }
  if (
    item.verificationStatus === "verified" &&
    item.deliveryHealth === "bounced"
  ) {
    return "bounced";
  }
  if (item.verificationStatus === "verified") {
    return "verified";
  }
  return "pending";
}

export type OverviewNotificationIdentitySummary =
  | { kind: "none" }
  | {
      kind: "identity";
      email: string;
      displayStatus: NotificationIdentityDisplayStatus;
      verifiedAt: string | null;
    };

/** Primary self identity for Overview — no internal ids or secrets. */
export function resolveOverviewNotificationIdentitySummary(
  items: NotificationIdentityApiItem[],
): OverviewNotificationIdentitySummary {
  const verified = findActiveVerifiedNotificationIdentity(items);
  const pending = findActivePendingNotificationIdentity(items);
  const primary = verified ?? pending;

  if (primary) {
    return {
      kind: "identity",
      email: primary.email,
      displayStatus: resolveNotificationIdentityDisplayStatus(primary),
      verifiedAt: primary.verifiedAt,
    };
  }

  const latestRevoked = items
    .filter(
      (item) =>
        item.revokedAt != null || item.verificationStatus === "revoked",
    )
    .sort((left, right) =>
      (right.revokedAt ?? right.updatedAt).localeCompare(
        left.revokedAt ?? left.updatedAt,
      ),
    )[0];

  if (latestRevoked) {
    return {
      kind: "identity",
      email: latestRevoked.email,
      displayStatus: resolveNotificationIdentityDisplayStatus(latestRevoked),
      verifiedAt: latestRevoked.verifiedAt,
    };
  }

  return { kind: "none" };
}

export function resolveNotificationIdentityManagementActions(input: {
  canManage: boolean;
  canIssueToken: boolean;
  pending: NotificationIdentityApiItem | null;
  verified?: NotificationIdentityApiItem | null;
}): NotificationIdentityManagementActions {
  if (!input.canManage) {
    return {
      showAddEmail: false,
      showIssueToken: false,
      showVerify: false,
    };
  }

  const hasActivePending = input.pending != null;
  const hasVerified = input.verified != null;
  return {
    showAddEmail: !hasActivePending && !hasVerified,
    showIssueToken: input.canIssueToken && hasActivePending,
    showVerify: false,
  };
}

export type NotificationIdentityUxPhase =
  | "empty"
  | "pending"
  | "verified"
  | "revoked"
  | "bounced";

export function resolvePrimaryNotificationIdentity(
  items: NotificationIdentityApiItem[],
): NotificationIdentityApiItem | null {
  const verified = findActiveVerifiedNotificationIdentity(items);
  const pending = findActivePendingNotificationIdentity(items);
  const primary = verified ?? pending;
  if (primary) {
    return primary;
  }

  const latestRevoked = items
    .filter(
      (item) => resolveNotificationIdentityDisplayStatus(item) === "revoked",
    )
    .sort((left, right) =>
      (right.revokedAt ?? "").localeCompare(left.revokedAt ?? ""),
    )[0];

  return latestRevoked ?? null;
}

export function resolveNotificationIdentityUxPhase(
  items: NotificationIdentityApiItem[],
): NotificationIdentityUxPhase {
  const primary = resolvePrimaryNotificationIdentity(items);
  if (!primary) {
    return "empty";
  }
  return resolveNotificationIdentityDisplayStatus(primary);
}

export function shouldShowAdvancedVerificationTools(input: {
  canIssueToken: boolean;
  pending: NotificationIdentityApiItem | null;
}): boolean {
  return input.canIssueToken && input.pending != null;
}

export function notificationIdentitiesPath(userId: string): string {
  return `/api/mail/access/${encodeURIComponent(userId)}/notification-identities`;
}

export function notificationIdentityVerifyPath(identityId: string): string {
  return `/api/mail/notification-identities/${encodeURIComponent(identityId)}/verify`;
}

export const NOTIFICATION_IDENTITY_SELF_ISSUE_TOKEN_PATH =
  "/api/mail/admin/notification-identities/self/issue-verification-token";

export type VerificationTokenModalPayload = {
  token: string;
  expiresAt: string;
};

/** Clears token from modal state — call when closing the one-time token dialog. */
export function clearVerificationTokenModalPayload(): null {
  return null;
}
