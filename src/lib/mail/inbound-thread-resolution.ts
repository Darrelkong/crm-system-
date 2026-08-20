import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { MailMessage } from "../../../drizzle/schema/mail-messages";

export type InboundThreadResolution = {
  threadId: string;
  replyToMessageId: string | null;
  createThread: boolean;
};

function parseReferencesHeader(raw: string | null): string[] {
  if (!raw?.trim()) {
    return [];
  }
  const matches = raw.match(/<[^<>]+@[^<>]+>/g);
  return matches ?? [];
}

async function findInboundMessageByInternetMessageId(
  db: Database,
  mailboxId: string,
  internetMessageId: string,
): Promise<MailMessage | null> {
  const rows = await db
    .select()
    .from(schema.mailMessages)
    .where(
      and(
        eq(schema.mailMessages.mailboxId, mailboxId),
        eq(schema.mailMessages.direction, "inbound"),
        eq(schema.mailMessages.internetMessageId, internetMessageId),
      ),
    )
    .limit(2);
  if (rows.length === 0) {
    return null;
  }
  if (rows.length > 1) {
    return null;
  }
  return rows[0] ?? null;
}

/**
 * Conservative V1 threading — In-Reply-To / References only, same mailbox.
 * Never threads on subject alone or across mailboxes.
 */
export async function resolveInboundThread(
  db: Database,
  input: {
    mailboxId: string;
    inReplyTo: string | null;
    referencesHeader: string | null;
  },
): Promise<InboundThreadResolution> {
  if (input.inReplyTo) {
    const parent = await findInboundMessageByInternetMessageId(
      db,
      input.mailboxId,
      input.inReplyTo,
    );
    if (parent) {
      return {
        threadId: parent.threadId,
        replyToMessageId: parent.id,
        createThread: false,
      };
    }
  }

  const references = parseReferencesHeader(input.referencesHeader);
  for (let i = references.length - 1; i >= 0; i--) {
    const candidateId = references[i];
    const match = await findInboundMessageByInternetMessageId(
      db,
      input.mailboxId,
      candidateId,
    );
    if (match) {
      return {
        threadId: match.threadId,
        replyToMessageId: match.id,
        createThread: false,
      };
    }
  }

  return {
    threadId: crypto.randomUUID(),
    replyToMessageId: null,
    createThread: true,
  };
}
