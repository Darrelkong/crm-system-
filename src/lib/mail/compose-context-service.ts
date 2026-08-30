import { and, eq, isNull } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import {
  hasMailboxSendAuthorization,
  resolveOutboundComposeMailboxId,
} from "@/lib/mail/compose-authorization";
import { MailServiceError } from "@/lib/mail/errors";
import { assertMailAccessEnabled } from "@/lib/permissions/mail";

function isSystemNotificationSenderAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase();
  if (normalized === "notifications@send.echfronthk.com") {
    return true;
  }
  return normalized.endsWith("@send.echfronthk.com");
}

export type ComposeContextOptionView = {
  senderIdentityId: string;
  mailboxId: string;
  address: string;
  displayName: string | null;
  mailboxAddress: string;
  mailboxDisplayName: string | null;
  mailboxType: "personal" | "shared";
};

export async function listComposeContextOptions(
  db: Database,
  actor: MailActorContext,
): Promise<ComposeContextOptionView[]> {
  assertMailAccessEnabled(actor);

  const grants = await db
    .select()
    .from(schema.mailSenderIdentityGrants)
    .where(
      and(
        eq(schema.mailSenderIdentityGrants.userId, actor.userId),
        eq(schema.mailSenderIdentityGrants.canSend, 1),
        isNull(schema.mailSenderIdentityGrants.revokedAt),
      ),
    );

  const options: ComposeContextOptionView[] = [];

  for (const grant of grants) {
    const [identity] = await db
      .select()
      .from(schema.mailSenderIdentities)
      .where(eq(schema.mailSenderIdentities.id, grant.senderIdentityId))
      .limit(1);
    if (!identity || identity.status !== "active") {
      continue;
    }
    if (isSystemNotificationSenderAddress(identity.address)) {
      continue;
    }

    const composeMailboxId = resolveOutboundComposeMailboxId(identity);
    if (!composeMailboxId) {
      continue;
    }

    const [mailbox] = await db
      .select()
      .from(schema.mailMailboxes)
      .where(eq(schema.mailMailboxes.id, composeMailboxId))
      .limit(1);
    if (!mailbox || mailbox.status !== "active") {
      continue;
    }

    if (!(await hasMailboxSendAuthorization(db, actor, mailbox))) {
      continue;
    }

    options.push({
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
      address: identity.address,
      displayName: identity.displayName,
      mailboxAddress: mailbox.address,
      mailboxDisplayName: mailbox.displayName,
      mailboxType: mailbox.mailboxType,
    });
  }

  return options.sort((left, right) => left.address.localeCompare(right.address));
}

export async function assertComposeContextOption(
  db: Database,
  actor: MailActorContext,
  input: { senderIdentityId: string; mailboxId: string },
): Promise<ComposeContextOptionView> {
  const options = await listComposeContextOptions(db, actor);
  const match = options.find(
    (option) =>
      option.senderIdentityId === input.senderIdentityId &&
      option.mailboxId === input.mailboxId,
  );
  if (!match) {
    throw MailServiceError.forbidden("Selected From address is not authorized for compose");
  }
  return match;
}
