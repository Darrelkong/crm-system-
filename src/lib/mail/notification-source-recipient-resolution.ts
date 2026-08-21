import { and, eq, isNull } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import { findActiveVerifiedNotificationIdentity } from "@/lib/mail/notification-identity-service";

export type ResolvedNotificationTarget = {
  recipientUserId: string;
  notificationIdentityId: string;
  mailboxId: string | null;
};

async function isMailAccessEnabled(
  db: Database,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ isEnabled: schema.mailUserAccess.isEnabled })
    .from(schema.mailUserAccess)
    .where(eq(schema.mailUserAccess.userId, userId))
    .limit(1);
  return row?.isEnabled === 1;
}

async function resolveUserNotificationTarget(
  db: Database,
  userId: string,
  mailboxId: string | null = null,
): Promise<ResolvedNotificationTarget | null> {
  if (!(await isMailAccessEnabled(db, userId))) {
    return null;
  }
  const identity = await findActiveVerifiedNotificationIdentity(db, userId);
  if (!identity) {
    return null;
  }
  return {
    recipientUserId: userId,
    notificationIdentityId: identity.id,
    mailboxId,
  };
}

/**
 * Personal mailbox: exactly one active can_read member.
 * Shared mailbox: no V1 new_incoming notification.
 */
export async function resolveNewIncomingNotificationTarget(
  db: Database,
  mailboxId: string,
): Promise<ResolvedNotificationTarget | null> {
  const [mailbox] = await db
    .select({
      id: schema.mailMailboxes.id,
      mailboxType: schema.mailMailboxes.mailboxType,
    })
    .from(schema.mailMailboxes)
    .where(eq(schema.mailMailboxes.id, mailboxId))
    .limit(1);
  if (!mailbox || mailbox.mailboxType !== "personal") {
    return null;
  }

  const members = await db
    .select({ userId: schema.mailMailboxMembers.userId })
    .from(schema.mailMailboxMembers)
    .where(
      and(
        eq(schema.mailMailboxMembers.mailboxId, mailboxId),
        eq(schema.mailMailboxMembers.canRead, 1),
        isNull(schema.mailMailboxMembers.revokedAt),
      ),
    );

  if (members.length !== 1) {
    return null;
  }

  return resolveUserNotificationTarget(db, members[0]!.userId, mailboxId);
}

export async function resolveApprovalReturnedNotificationTarget(
  db: Database,
  requestedByUserId: string,
): Promise<ResolvedNotificationTarget | null> {
  return resolveUserNotificationTarget(db, requestedByUserId, null);
}

export async function resolveImportantSendFailureNotificationTarget(
  db: Database,
  input: { sendOperationId: string; initiatedByUserId: string | null },
): Promise<ResolvedNotificationTarget | null> {
  if (!input.initiatedByUserId) {
    return null;
  }
  return resolveUserNotificationTarget(db, input.initiatedByUserId, null);
}
