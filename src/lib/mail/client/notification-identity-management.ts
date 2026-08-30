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
  showVerify: boolean;
};

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
}): NotificationIdentityManagementActions {
  if (!input.canManage) {
    return {
      showAddEmail: false,
      showIssueToken: false,
      showVerify: false,
    };
  }

  const hasActivePending = input.pending != null;
  return {
    showAddEmail: !hasActivePending,
    showIssueToken: input.canIssueToken && hasActivePending,
    showVerify: hasActivePending,
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
