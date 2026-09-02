import { and, eq, isNull, or } from "drizzle-orm";
import type { User } from "../../../drizzle/schema/users";
import { schema, type Database } from "@/lib/db";

export const MAIL_EFFECTIVE_ACCESS_STATES = [
  "NO_MAILBOX",
  "MAILBOX_ASSIGNED_NOTIFICATION_MISSING",
  "MAILBOX_ASSIGNED_NOTIFICATION_PENDING",
  "READY",
  "ADMIN_DISABLED",
  "IDENTITY_SECURITY_REVOKED",
  "MAILBOX_ARCHIVED",
] as const;

export type MailEffectiveAccessState =
  (typeof MAIL_EFFECTIVE_ACCESS_STATES)[number];

export type MailboxAssignmentState = "none" | "active" | "archived";
export type NotificationIdentityState =
  | "missing"
  | "pending"
  | "verified"
  | "replacement_pending"
  | "security_revoked";

export type EffectiveMailAccessSnapshot = {
  mailboxState: MailboxAssignmentState;
  mailAccessEnabled: boolean;
  notificationIdentityState: NotificationIdentityState;
  effectiveState: MailEffectiveAccessState;
  canUseMailbox: boolean;
  canUseMailAdmin: boolean;
};

const NON_SECURITY_REVOKE_REASONS = new Set([
  "replaced_by_verified_identity",
  "pending_email_changed",
  "replacement_cancelled",
  "setup_cancelled",
  "replacement_cancelled_on_disable",
]);

function isSecurityRevocationReason(reason: string | null): boolean {
  return reason !== null && !NON_SECURITY_REVOKE_REASONS.has(reason);
}

async function resolveMailboxAssignmentState(
  db: Database,
  userId: string,
): Promise<MailboxAssignmentState> {
  const rows = await db
    .select({
      status: schema.mailMailboxes.status,
      mailboxType: schema.mailMailboxes.mailboxType,
      createdBy: schema.mailMailboxes.createdBy,
      memberId: schema.mailMailboxMembers.id,
    })
    .from(schema.mailMailboxes)
    .leftJoin(
      schema.mailMailboxMembers,
      and(
        eq(schema.mailMailboxMembers.mailboxId, schema.mailMailboxes.id),
        eq(schema.mailMailboxMembers.userId, userId),
        eq(schema.mailMailboxMembers.canRead, 1),
        isNull(schema.mailMailboxMembers.revokedAt),
      ),
    )
    .where(
      or(
        eq(schema.mailMailboxMembers.userId, userId),
        and(
          eq(schema.mailMailboxes.mailboxType, "personal"),
          eq(schema.mailMailboxes.createdBy, userId),
        ),
      ),
    );

  if (
    rows.some(
      (row) =>
        row.status === "active" &&
        (row.memberId !== null ||
          (row.mailboxType === "personal" && row.createdBy === userId)),
    )
  ) {
    return "active";
  }
  if (rows.some((row) => row.status === "archived")) {
    return "archived";
  }
  return "none";
}

async function resolveNotificationIdentityState(
  db: Database,
  userId: string,
): Promise<NotificationIdentityState> {
  const rows = await db
    .select({
      verificationStatus: schema.mailNotificationIdentities.verificationStatus,
      revokedAt: schema.mailNotificationIdentities.revokedAt,
      revokeReason: schema.mailNotificationIdentities.revokeReason,
    })
    .from(schema.mailNotificationIdentities)
    .where(eq(schema.mailNotificationIdentities.userId, userId));

  const verified = rows.some(
    (row) => row.verificationStatus === "verified" && row.revokedAt === null,
  );
  const pending = rows.some(
    (row) => row.verificationStatus === "pending" && row.revokedAt === null,
  );
  if (verified && pending) return "replacement_pending";
  if (verified) return "verified";
  if (pending) return "pending";
  if (
    rows.some(
      (row) =>
        row.verificationStatus === "revoked" &&
        isSecurityRevocationReason(row.revokeReason),
    )
  ) {
    return "security_revoked";
  }
  return "missing";
}

export async function resolveEffectiveMailAccessState(
  db: Database,
  input: {
    userId: string;
    userRole: User["role"];
    mailAccessEnabled: boolean;
  },
): Promise<EffectiveMailAccessSnapshot> {
  const [mailboxState, notificationIdentityState] = await Promise.all([
    resolveMailboxAssignmentState(db, input.userId),
    resolveNotificationIdentityState(db, input.userId),
  ]);

  if (input.userRole === "admin") {
    return {
      mailboxState,
      mailAccessEnabled: input.mailAccessEnabled,
      notificationIdentityState,
      effectiveState:
        mailboxState === "archived" ? "MAILBOX_ARCHIVED" : "READY",
      canUseMailbox: true,
      canUseMailAdmin: true,
    };
  }

  let effectiveState: MailEffectiveAccessState;
  if (mailboxState === "none") {
    effectiveState = "NO_MAILBOX";
  } else if (mailboxState === "archived") {
    effectiveState = "MAILBOX_ARCHIVED";
  } else if (notificationIdentityState === "security_revoked") {
    effectiveState = "IDENTITY_SECURITY_REVOKED";
  } else if (!input.mailAccessEnabled) {
    effectiveState = "ADMIN_DISABLED";
  } else if (
    notificationIdentityState === "verified" ||
    notificationIdentityState === "replacement_pending"
  ) {
    effectiveState = "READY";
  } else if (notificationIdentityState === "pending") {
    effectiveState = "MAILBOX_ASSIGNED_NOTIFICATION_PENDING";
  } else {
    effectiveState = "MAILBOX_ASSIGNED_NOTIFICATION_MISSING";
  }

  return {
    mailboxState,
    mailAccessEnabled: input.mailAccessEnabled,
    notificationIdentityState,
    effectiveState,
    canUseMailbox: effectiveState === "READY",
    canUseMailAdmin: false,
  };
}

export function resolveEffectiveStateFromSnapshot(input: {
  userRole: User["role"];
  mailAccessEnabled: boolean;
  mailboxState?: MailboxAssignmentState;
  notificationIdentityState?: NotificationIdentityState;
}): EffectiveMailAccessSnapshot {
  const mailboxState = input.mailboxState ?? "none";
  const notificationIdentityState =
    input.notificationIdentityState ?? "missing";
  if (input.userRole === "admin") {
    return {
      mailboxState,
      mailAccessEnabled: input.mailAccessEnabled,
      notificationIdentityState,
      effectiveState:
        mailboxState === "archived" ? "MAILBOX_ARCHIVED" : "READY",
      canUseMailbox: true,
      canUseMailAdmin: true,
    };
  }
  const effectiveState =
    mailboxState === "none"
      ? "NO_MAILBOX"
      : mailboxState === "archived"
        ? "MAILBOX_ARCHIVED"
        : notificationIdentityState === "security_revoked"
          ? "IDENTITY_SECURITY_REVOKED"
          : !input.mailAccessEnabled
            ? "ADMIN_DISABLED"
            : notificationIdentityState === "verified" ||
                notificationIdentityState === "replacement_pending"
              ? "READY"
              : notificationIdentityState === "pending"
                ? "MAILBOX_ASSIGNED_NOTIFICATION_PENDING"
                : "MAILBOX_ASSIGNED_NOTIFICATION_MISSING";
  return {
    mailboxState,
    mailAccessEnabled: input.mailAccessEnabled,
    notificationIdentityState,
    effectiveState,
    canUseMailbox: effectiveState === "READY",
    canUseMailAdmin: false,
  };
}
