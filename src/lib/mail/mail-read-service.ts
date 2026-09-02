import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  lt,
  or,
  type SQL,
} from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MailServiceError } from "@/lib/mail/errors";
import type { MailWorkspaceFolder } from "@/lib/mail/mail-folder-resolver";
import {
  buildMessageFolderConditions,
  messageSortTimestamp,
  resolveMessageFolderQuery,
  type MessageFolderOrderColumn,
} from "@/lib/mail/mail-folder-resolver";
import { resolveMessageCustomerAssociation } from "@/lib/mail/mail-customer-context-resolver";
import {
  toMailMessageAttachmentMetadataView,
  toMailMessageDetailRecipientView,
  toMailMessageDetailView,
  toMailMessageListView,
  type MailMessageDetailView,
  type MailMessageListView,
} from "@/lib/mail/mail-read-serialization";
import { getThreadSummary } from "@/lib/mail/mail-thread-service";
import {
  assertCanReadMailbox,
  assertCanReadMessage,
  buildRecipientVisibilityContext,
  filterRecipientsForViewer,
  type MailMessageReadContext,
} from "@/lib/mail/message-read-permissions";

export type {
  MailMessageAttachmentMetadataView,
  MailMessageDetailRecipientView,
  MailMessageDetailView,
  MailMessageListSenderView,
  MailMessageListView,
} from "@/lib/mail/mail-read-serialization";

export type MailMessageListPage = {
  items: MailMessageListView[];
  nextCursor: string | null;
};

export type ListAccessibleMessagesInput = {
  mailboxId: string;
  folder: MailWorkspaceFolder;
  cursor?: string | null;
  limit?: number;
};

export const MAIL_READ_DEFAULT_LIMIT = 50;
export const MAIL_READ_MAX_LIMIT = 100;

type MailReadCursor = {
  timestamp: string;
  id: string;
  orderColumn: MessageFolderOrderColumn;
};

function resolveMailReadLimit(limit?: number): number {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) {
    return MAIL_READ_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), MAIL_READ_MAX_LIMIT);
}

export function encodeMailReadCursor(input: MailReadCursor): string {
  return Buffer.from(JSON.stringify(input), "utf8").toString("base64url");
}

export function decodeMailReadCursor(cursor: string): MailReadCursor | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<MailReadCursor>;
    if (
      typeof parsed.timestamp !== "string" ||
      typeof parsed.id !== "string" ||
      (parsed.orderColumn !== "receivedAt" &&
        parsed.orderColumn !== "sentAt" &&
        parsed.orderColumn !== "trashedAt")
    ) {
      return null;
    }
    return {
      timestamp: parsed.timestamp,
      id: parsed.id,
      orderColumn: parsed.orderColumn,
    };
  } catch {
    return null;
  }
}

function orderColumnExpression(orderColumn: MessageFolderOrderColumn) {
  switch (orderColumn) {
    case "receivedAt":
      return schema.mailMessages.receivedAt;
    case "sentAt":
      return schema.mailMessages.sentAt;
    case "trashedAt":
      return schema.mailMessages.trashedAt;
  }
}

function buildCursorCondition(
  orderColumn: MessageFolderOrderColumn,
  cursor: MailReadCursor,
): SQL {
  const column = orderColumnExpression(orderColumn);
  return or(
    lt(column, cursor.timestamp),
    and(eq(column, cursor.timestamp), lt(schema.mailMessages.id, cursor.id)),
  )!;
}

async function loadReadStatesForMessages(
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

async function loadAttachmentCounts(
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
 * Returns a paginated safe list of messages for an authorized mailbox folder.
 */
export async function listAccessibleMessages(
  db: Database,
  actor: MailActorContext,
  input: ListAccessibleMessagesInput,
): Promise<MailMessageListPage> {
  await assertCanReadMailbox(db, actor, input.mailboxId);

  const folderSpec = resolveMessageFolderQuery(input.folder);
  const limit = resolveMailReadLimit(input.limit);
  const conditions = buildMessageFolderConditions(input.mailboxId, folderSpec);

  if (input.cursor) {
    const decoded = decodeMailReadCursor(input.cursor);
    if (
      !decoded ||
      decoded.orderColumn !== folderSpec.orderColumn
    ) {
      throw MailServiceError.validation("Invalid message list cursor");
    }
    conditions.push(buildCursorCondition(folderSpec.orderColumn, decoded));
  }

  const orderColumn = orderColumnExpression(folderSpec.orderColumn);
  const rows = await db
    .select()
    .from(schema.mailMessages)
    .where(and(...conditions))
    .orderBy(desc(orderColumn), desc(schema.mailMessages.id))
    .limit(limit + 1);

  const pageRows = rows.slice(0, limit);
  const messageIds = pageRows.map((row) => row.id);
  const [readStates, attachmentCounts] = await Promise.all([
    loadReadStatesForMessages(db, actor, messageIds),
    loadAttachmentCounts(db, messageIds),
  ]);

  const items = pageRows.map((message) =>
    toMailMessageListView({
      message,
      timestamp: messageSortTimestamp(message, folderSpec.orderColumn),
      readState: readStates.get(message.id) ?? null,
      attachmentCount: attachmentCounts.get(message.id) ?? 0,
    }),
  );

  let nextCursor: string | null = null;
  if (rows.length > limit) {
    const last = pageRows[pageRows.length - 1]!;
    nextCursor = encodeMailReadCursor({
      timestamp: messageSortTimestamp(last, folderSpec.orderColumn),
      id: last.id,
      orderColumn: folderSpec.orderColumn,
    });
  }

  return { items, nextCursor };
}

/**
 * Returns full readable detail for one authorized message.
 * CRM customer association is resolved independently after mail read authorization.
 */
export async function getMessageDetail(
  db: Database,
  actor: MailActorContext,
  messageId: string,
  context?: MailMessageReadContext,
): Promise<MailMessageDetailView> {
  const { message, mailboxAccess } = await assertCanReadMessage(
    db,
    actor,
    messageId,
    context,
  );

  const [body] = await db
    .select()
    .from(schema.mailMessageBodies)
    .where(eq(schema.mailMessageBodies.messageId, messageId))
    .limit(1);

  if (!body) {
    throw MailServiceError.notFound("Message body not found");
  }

  const recipientRows = await db
    .select({
      recipientType: schema.mailMessageRecipients.recipientType,
      address: schema.mailMessageRecipients.address,
      displayName: schema.mailMessageRecipients.displayName,
      sortOrder: schema.mailMessageRecipients.sortOrder,
    })
    .from(schema.mailMessageRecipients)
    .where(eq(schema.mailMessageRecipients.messageId, messageId))
    .orderBy(asc(schema.mailMessageRecipients.sortOrder));

  const visibilityContext = buildRecipientVisibilityContext(
    actor,
    message,
    mailboxAccess,
  );
  const recipients = filterRecipientsForViewer(
    recipientRows,
    visibilityContext,
  ).map(toMailMessageDetailRecipientView);

  const attachmentRows = await db
    .select({
      attachment: schema.mailMessageAttachments,
      securityScanStatus: schema.mailStoredFiles.securityScanStatus,
      trustedMimeType: schema.mailStoredFiles.mimeType,
    })
    .from(schema.mailMessageAttachments)
    .innerJoin(
      schema.mailStoredFiles,
      eq(
        schema.mailMessageAttachments.storedFileId,
        schema.mailStoredFiles.id,
      ),
    )
    .where(eq(schema.mailMessageAttachments.messageId, messageId))
    .orderBy(asc(schema.mailMessageAttachments.sortOrder));

  const [readStates, thread, customerAssociation] = await Promise.all([
    loadReadStatesForMessages(db, actor, [messageId]),
    getThreadSummary(db, actor, message.threadId),
    resolveMessageCustomerAssociation(db, actor, message),
  ]);

  return toMailMessageDetailView({
    message,
    body,
    recipients,
    attachments: attachmentRows.map((row) =>
      toMailMessageAttachmentMetadataView({
        attachment: row.attachment,
        securityScanStatus: row.securityScanStatus,
        trustedMimeType: row.trustedMimeType,
      }),
    ),
    thread,
    readState: readStates.get(messageId) ?? null,
    customerAssociation,
  });
}
