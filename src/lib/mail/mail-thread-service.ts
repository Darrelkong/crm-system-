import { and, asc, count, eq, inArray, max } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MailServiceError } from "@/lib/mail/errors";
import {
  toMailMessageListView,
  type MailMessageListView,
} from "@/lib/mail/mail-read-serialization";
import { assertCanReadMailbox } from "@/lib/mail/message-read-permissions";

export type MailThreadSummaryView = {
  id: string;
  mailboxId: string;
  subjectNormalized: string | null;
  messageCount: number;
  latestMessageAt: string;
};

export async function getThreadSummary(
  db: Database,
  actor: MailActorContext,
  threadId: string,
): Promise<MailThreadSummaryView> {
  const [thread] = await db
    .select()
    .from(schema.mailThreads)
    .where(eq(schema.mailThreads.id, threadId))
    .limit(1);

  if (!thread) {
    throw MailServiceError.notFound("Thread not found");
  }

  await assertCanReadMailbox(db, actor, thread.mailboxId);

  const [stats] = await db
    .select({
      messageCount: count(schema.mailMessages.id),
      latestMessageAt: max(schema.mailMessages.createdAt),
    })
    .from(schema.mailMessages)
    .where(
      and(
        eq(schema.mailMessages.threadId, threadId),
        eq(schema.mailMessages.mailboxId, thread.mailboxId),
      ),
    );

  const messageCount = Number(stats?.messageCount ?? 0);
  const latestMessageAt = stats?.latestMessageAt ?? thread.lastMessageAt;

  return {
    id: thread.id,
    mailboxId: thread.mailboxId,
    subjectNormalized: thread.subjectNormalized,
    messageCount,
    latestMessageAt,
  };
}

export async function getThreadSummariesByIds(
  db: Database,
  threadIds: string[],
): Promise<Map<string, MailThreadSummaryView>> {
  if (threadIds.length === 0) {
    return new Map();
  }

  const uniqueThreadIds = [...new Set(threadIds)];
  const threads = await db
    .select()
    .from(schema.mailThreads)
    .where(inArray(schema.mailThreads.id, uniqueThreadIds));

  const summaries = new Map<string, MailThreadSummaryView>();
  for (const thread of threads) {
    const [stats] = await db
      .select({
        messageCount: count(schema.mailMessages.id),
        latestMessageAt: max(schema.mailMessages.createdAt),
      })
      .from(schema.mailMessages)
      .where(
        and(
          eq(schema.mailMessages.threadId, thread.id),
          eq(schema.mailMessages.mailboxId, thread.mailboxId),
        ),
      );

    summaries.set(thread.id, {
      id: thread.id,
      mailboxId: thread.mailboxId,
      subjectNormalized: thread.subjectNormalized,
      messageCount: Number(stats?.messageCount ?? 0),
      latestMessageAt: stats?.latestMessageAt ?? thread.lastMessageAt,
    });
  }

  return summaries;
}

export type MailThreadMessagesResult = {
  thread: MailThreadSummaryView;
  items: MailMessageListView[];
};

function threadMessageTimestamp(message: {
  direction: "inbound" | "outbound";
  receivedAt: string | null;
  sentAt: string | null;
  createdAt: string;
}): string {
  if (message.direction === "outbound") {
    return message.sentAt ?? message.receivedAt ?? message.createdAt;
  }
  return message.receivedAt ?? message.sentAt ?? message.createdAt;
}

async function loadReadStatesForThreadMessages(
  db: Database,
  actor: MailActorContext,
  messageIds: string[],
) {
  if (messageIds.length === 0) {
    return new Map<string, (typeof schema.mailMessageReadStates.$inferSelect)>();
  }

  const rows = await db
    .select()
    .from(schema.mailMessageReadStates)
    .where(
      and(
        inArray(schema.mailMessageReadStates.messageId, messageIds),
        eq(schema.mailMessageReadStates.userId, actor.userId),
      ),
    );

  return new Map(rows.map((row) => [row.messageId, row]));
}

async function loadAttachmentCountsForThreadMessages(
  db: Database,
  messageIds: string[],
): Promise<Map<string, number>> {
  if (messageIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      messageId: schema.mailMessageAttachments.messageId,
      attachmentCount: count(schema.mailMessageAttachments.id),
    })
    .from(schema.mailMessageAttachments)
    .where(inArray(schema.mailMessageAttachments.messageId, messageIds))
    .groupBy(schema.mailMessageAttachments.messageId);

  return new Map(
    rows.map((row) => [row.messageId, Number(row.attachmentCount ?? 0)]),
  );
}

/**
 * Returns safe thread summary plus ordered list rows (oldest → newest).
 * Requires mailboxId so thread access is bound to an authorized mailbox context.
 */
export async function getThreadMessages(
  db: Database,
  actor: MailActorContext,
  threadId: string,
  mailboxId: string,
): Promise<MailThreadMessagesResult> {
  await assertCanReadMailbox(db, actor, mailboxId);

  const [thread] = await db
    .select()
    .from(schema.mailThreads)
    .where(eq(schema.mailThreads.id, threadId))
    .limit(1);

  if (!thread || thread.mailboxId !== mailboxId) {
    throw MailServiceError.notFound("Thread not found");
  }

  const messages = await db
    .select()
    .from(schema.mailMessages)
    .where(
      and(
        eq(schema.mailMessages.threadId, threadId),
        eq(schema.mailMessages.mailboxId, mailboxId),
      ),
    )
    .orderBy(asc(schema.mailMessages.createdAt), asc(schema.mailMessages.id));

  const messageIds = messages.map((message) => message.id);
  const [readStates, attachmentCounts] = await Promise.all([
    loadReadStatesForThreadMessages(db, actor, messageIds),
    loadAttachmentCountsForThreadMessages(db, messageIds),
  ]);

  const items = messages.map((message) =>
    toMailMessageListView({
      message,
      timestamp: threadMessageTimestamp(message),
      readState: readStates.get(message.id) ?? null,
      attachmentCount: attachmentCounts.get(message.id) ?? 0,
    }),
  );

  const [stats] = await db
    .select({
      messageCount: count(schema.mailMessages.id),
      latestMessageAt: max(schema.mailMessages.createdAt),
    })
    .from(schema.mailMessages)
    .where(
      and(
        eq(schema.mailMessages.threadId, threadId),
        eq(schema.mailMessages.mailboxId, mailboxId),
      ),
    );

  return {
    thread: {
      id: thread.id,
      mailboxId: thread.mailboxId,
      subjectNormalized: thread.subjectNormalized,
      messageCount: Number(stats?.messageCount ?? 0),
      latestMessageAt: stats?.latestMessageAt ?? thread.lastMessageAt,
    },
    items,
  };
}
