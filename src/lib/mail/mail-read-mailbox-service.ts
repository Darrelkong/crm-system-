import { and, eq, isNull } from "drizzle-orm";
import type { MailMailbox } from "../../../drizzle/schema/mail-mailboxes";
import type { MailMailboxMember } from "../../../drizzle/schema/mail-mailbox-members";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import type { MailReadAccessMode } from "@/lib/mail/message-read-permissions";
import { hasGlobalMailReadGrant } from "@/lib/mail/message-read-permissions";
import { assertEffectiveMailAccess } from "@/lib/permissions/mail";

export type AccessibleMailboxPermissionsView = {
  canRead: boolean;
  canReply: boolean;
  canSend: boolean;
};

export type AccessibleMailboxView = {
  id: string;
  address: string;
  displayName: string | null;
  mailboxType: MailMailbox["mailboxType"];
  accessMode: MailReadAccessMode;
  permissions: AccessibleMailboxPermissionsView;
};

type AccessibleMailboxCandidate = AccessibleMailboxView & {
  sortLabel: string;
};

function mailboxSortLabel(mailbox: MailMailbox): string {
  return (mailbox.displayName ?? mailbox.address).toLowerCase();
}

function memberPermissions(
  membership: MailMailboxMember,
): AccessibleMailboxPermissionsView {
  return {
    canRead: membership.canRead === 1,
    canReply: membership.canReply === 1,
    canSend: membership.canSend === 1,
  };
}

function ownerWithoutMembershipPermissions(): AccessibleMailboxPermissionsView {
  return {
    canRead: true,
    canReply: false,
    canSend: false,
  };
}

function globalReadPermissions(): AccessibleMailboxPermissionsView {
  return {
    canRead: true,
    canReply: false,
    canSend: false,
  };
}

function sortAccessibleMailboxes(
  items: AccessibleMailboxCandidate[],
): AccessibleMailboxView[] {
  const categoryRank = (item: AccessibleMailboxCandidate): number => {
    if (item.accessMode === "global_read") {
      return 3;
    }
    if (item.mailboxType === "personal") {
      return 1;
    }
    return 2;
  };

  return [...items]
    .sort((left, right) => {
      const categoryDiff = categoryRank(left) - categoryRank(right);
      if (categoryDiff !== 0) {
        return categoryDiff;
      }
      const labelDiff = left.sortLabel.localeCompare(right.sortLabel);
      if (labelDiff !== 0) {
        return labelDiff;
      }
      return left.address.localeCompare(right.address);
    })
    .map(({ sortLabel: _sortLabel, ...view }) => view);
}

function isPersonalMailboxOwner(
  mailbox: MailMailbox,
  actor: MailActorContext,
): boolean {
  return (
    mailbox.mailboxType === "personal" &&
    mailbox.createdBy != null &&
    mailbox.createdBy === actor.userId
  );
}

/**
 * Returns active mailboxes the actor may read, with safe permission flags.
 */
export async function listAccessibleMailboxes(
  db: Database,
  actor: MailActorContext,
): Promise<AccessibleMailboxView[]> {
  assertEffectiveMailAccess(actor);

  const activeMailboxes = await db
    .select()
    .from(schema.mailMailboxes)
    .where(eq(schema.mailMailboxes.status, "active"));

  const memberships = await db
    .select()
    .from(schema.mailMailboxMembers)
    .where(
      and(
        eq(schema.mailMailboxMembers.userId, actor.userId),
        eq(schema.mailMailboxMembers.canRead, 1),
        isNull(schema.mailMailboxMembers.revokedAt),
      ),
    );

  const membershipByMailboxId = new Map(
    memberships.map((membership) => [membership.mailboxId, membership]),
  );

  const candidates = new Map<string, AccessibleMailboxCandidate>();
  const globalRead = hasGlobalMailReadGrant(actor);

  for (const mailbox of activeMailboxes) {
    const membership = membershipByMailboxId.get(mailbox.id);
    if (membership) {
      candidates.set(mailbox.id, {
        id: mailbox.id,
        address: mailbox.address,
        displayName: mailbox.displayName,
        mailboxType: mailbox.mailboxType,
        accessMode: "member",
        permissions: memberPermissions(membership),
        sortLabel: mailboxSortLabel(mailbox),
      });
      continue;
    }

    if (isPersonalMailboxOwner(mailbox, actor)) {
      candidates.set(mailbox.id, {
        id: mailbox.id,
        address: mailbox.address,
        displayName: mailbox.displayName,
        mailboxType: mailbox.mailboxType,
        accessMode: "member",
        permissions: ownerWithoutMembershipPermissions(),
        sortLabel: mailboxSortLabel(mailbox),
      });
      continue;
    }

    if (globalRead) {
      candidates.set(mailbox.id, {
        id: mailbox.id,
        address: mailbox.address,
        displayName: mailbox.displayName,
        mailboxType: mailbox.mailboxType,
        accessMode: "global_read",
        permissions: globalReadPermissions(),
        sortLabel: mailboxSortLabel(mailbox),
      });
    }
  }

  return sortAccessibleMailboxes([...candidates.values()]);
}
