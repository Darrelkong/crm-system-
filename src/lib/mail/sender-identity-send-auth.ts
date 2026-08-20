import { and, eq, isNull } from "drizzle-orm";
import type { MailSenderIdentity } from "../../../drizzle/schema/mail-sender-identities";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MailServiceError } from "@/lib/mail/errors";

export type SenderIdentitySendGrantContext = {
  identity: MailSenderIdentity;
  grantId: string;
};

/**
 * Identity-layer send grant authorization.
 *
 * Proves: Mail-enabled actor holds an active exact Sender Identity grant with
 * can_send for an active Sender Identity.
 *
 * Does NOT prove the actor may complete an outbound send. Future outbound
 * services must implement a separate full check (e.g. assertCanSendFromIdentityInMailbox)
 * that also verifies relevant mail_mailbox_members.can_send for the selected mailbox
 * context, plus default/reply/shared mailbox semantics.
 *
 * super_admin does NOT bypass this helper.
 */
export async function assertHasSenderIdentitySendGrant(
  db: Database,
  actor: MailActorContext,
  senderIdentityId: string,
): Promise<SenderIdentitySendGrantContext> {
  if (!actor.mailAccessEnabled) {
    throw MailServiceError.forbidden("Mail access is not enabled for this user");
  }

  const [identity] = await db
    .select()
    .from(schema.mailSenderIdentities)
    .where(eq(schema.mailSenderIdentities.id, senderIdentityId))
    .limit(1);
  if (!identity) {
    throw MailServiceError.notFound("Sender identity not found");
  }
  if (identity.status !== "active") {
    throw MailServiceError.forbidden("Sender identity is not active");
  }

  const [grant] = await db
    .select()
    .from(schema.mailSenderIdentityGrants)
    .where(
      and(
        eq(schema.mailSenderIdentityGrants.senderIdentityId, senderIdentityId),
        eq(schema.mailSenderIdentityGrants.userId, actor.userId),
        eq(schema.mailSenderIdentityGrants.canSend, 1),
        isNull(schema.mailSenderIdentityGrants.revokedAt),
      ),
    )
    .limit(1);
  if (!grant) {
    throw MailServiceError.forbidden(
      "Sender identity send grant required for this identity",
    );
  }

  return { identity, grantId: grant.id };
}
