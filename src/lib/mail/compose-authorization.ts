import { and, eq, isNull } from "drizzle-orm";
import type { MailMailbox } from "../../../drizzle/schema/mail-mailboxes";
import type { MailMailboxMember } from "../../../drizzle/schema/mail-mailbox-members";
import type { MailSenderIdentity } from "../../../drizzle/schema/mail-sender-identities";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MailServiceError } from "@/lib/mail/errors";
import { assertHasSenderIdentitySendGrant } from "@/lib/mail/sender-identity-send-auth";

export type ComposeAuthorizationContext = {
  identity: MailSenderIdentity;
  grantId: string;
  mailbox: MailMailbox;
  /** Null when personal mailbox owner authorization applies (no membership row). */
  membership: MailMailboxMember | null;
};

/**
 * Personal mailbox ownership — `mail_mailboxes.created_by` for `mailbox_type = personal`.
 * Read access uses the same rule in mail-read-mailbox-service; send uses this helper.
 */
export function isPersonalMailboxOwner(
  mailbox: Pick<MailMailbox, "mailboxType" | "createdBy">,
  actor: Pick<MailActorContext, "userId">,
): boolean {
  return (
    mailbox.mailboxType === "personal" &&
    mailbox.createdBy != null &&
    mailbox.createdBy === actor.userId
  );
}

async function findActiveMailboxSendMembershipForUser(
  db: Database,
  userId: string,
  mailboxId: string,
): Promise<MailMailboxMember | null> {
  const [membership] = await db
    .select()
    .from(schema.mailMailboxMembers)
    .where(
      and(
        eq(schema.mailMailboxMembers.mailboxId, mailboxId),
        eq(schema.mailMailboxMembers.userId, userId),
        eq(schema.mailMailboxMembers.canSend, 1),
        isNull(schema.mailMailboxMembers.revokedAt),
      ),
    )
    .limit(1);
  return membership ?? null;
}

async function findActiveMailboxSendMembership(
  db: Database,
  actor: MailActorContext,
  mailboxId: string,
): Promise<MailMailboxMember | null> {
  return findActiveMailboxSendMembershipForUser(db, actor.userId, mailboxId);
}

/**
 * Mailbox-layer send authorization.
 *
 * Personal mailbox: canonical owner (`created_by`) — no `mail_mailbox_members` row.
 * Shared mailbox: active membership with `can_send = 1`.
 */
export async function assertMailboxSendAuthorization(
  db: Database,
  actor: MailActorContext,
  mailbox: MailMailbox,
): Promise<MailMailboxMember | null> {
  if (isPersonalMailboxOwner(mailbox, actor)) {
    return null;
  }

  const membership = await findActiveMailboxSendMembership(db, actor, mailbox.id);
  if (!membership) {
    throw MailServiceError.forbidden(
      "Mailbox send membership required for this mailbox",
    );
  }
  return membership;
}

export async function hasMailboxSendAuthorizationForUser(
  db: Database,
  userId: string,
  mailbox: MailMailbox,
): Promise<boolean> {
  if (
    mailbox.mailboxType === "personal" &&
    mailbox.createdBy != null &&
    mailbox.createdBy === userId
  ) {
    return true;
  }
  return (
    (await findActiveMailboxSendMembershipForUser(db, userId, mailbox.id)) !=
    null
  );
}

export async function hasMailboxSendAuthorization(
  db: Database,
  actor: MailActorContext,
  mailbox: MailMailbox,
): Promise<boolean> {
  return hasMailboxSendAuthorizationForUser(db, actor.userId, mailbox);
}

/**
 * Resolves the outbound Compose mailbox for a Sender Identity.
 *
 * CASE A: `default_mailbox_id` IS NOT NULL → only default is valid Compose context.
 *         `sent_folder_mailbox_id` is NOT an alternate Compose mailbox.
 *
 * CASE B: `default_mailbox_id` IS NULL and `sent_folder_mailbox_id` IS NOT NULL
 *         → sent_folder is outbound Compose fallback (send-only identity).
 *
 * Frozen 0052 / Drizzle: when default is NULL, sent_folder is required and the actor
 * must hold mailbox membership on sent_folder with appropriate can_send.
 */
export function resolveOutboundComposeMailboxId(
  identity: MailSenderIdentity,
): string | null {
  if (identity.defaultMailboxId) {
    return identity.defaultMailboxId;
  }
  return identity.sentFolderMailboxId ?? null;
}

/**
 * Full compose authorization for Draft save and Revision creation.
 *
 * Requires BOTH:
 * - active exact Sender Identity grant with can_send
 * - mailbox send authorization:
 *     personal owner (`created_by`) OR shared membership with can_send
 *
 * Also validates Sender Identity ↔ Compose mailbox relationship (CASE A / CASE B above).
 */
export async function assertCanComposeFromIdentityInMailbox(
  db: Database,
  actor: MailActorContext,
  input: { senderIdentityId: string; mailboxId: string },
): Promise<ComposeAuthorizationContext> {
  const { identity, grantId } = await assertHasSenderIdentitySendGrant(
    db,
    actor,
    input.senderIdentityId,
  );

  const [mailbox] = await db
    .select()
    .from(schema.mailMailboxes)
    .where(eq(schema.mailMailboxes.id, input.mailboxId))
    .limit(1);
  if (!mailbox) {
    throw MailServiceError.notFound("Mailbox not found");
  }
  if (mailbox.status !== "active") {
    throw MailServiceError.forbidden("Mailbox is not active");
  }

  assertSenderIdentityMailboxRelationship(identity, mailbox.id);

  const membership = await assertMailboxSendAuthorization(db, actor, mailbox);

  return { identity, grantId, mailbox, membership };
}

export function assertSenderIdentityMailboxRelationship(
  identity: MailSenderIdentity,
  mailboxId: string,
): void {
  const composeMailboxId = resolveOutboundComposeMailboxId(identity);
  if (!composeMailboxId || composeMailboxId !== mailboxId) {
    if (identity.defaultMailboxId) {
      throw MailServiceError.validation(
        "Mailbox is not the sender identity default compose mailbox",
      );
    }
    throw MailServiceError.validation(
      "Mailbox is not the sender identity sent-folder compose fallback mailbox",
    );
  }
}
