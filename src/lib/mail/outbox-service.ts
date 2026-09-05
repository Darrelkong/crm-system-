import { and, desc, eq, exists, inArray, lt, or, sql } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MailServiceError } from "@/lib/mail/errors";
import { assertEffectiveMailAccess } from "@/lib/permissions/mail";
import { listAccessibleMailboxes } from "@/lib/mail/mail-read-mailbox-service";
import {
  assertCanUseAllMailboxScope,
  type MailboxScope,
} from "@/lib/mail/mailbox-scope";
import type { MailSourceMailboxView } from "@/lib/mail/mail-source-mailbox";

const OUTBOX_STATUSES = [
  "pending",
  "processing",
  "failed",
  "dispatch_uncertain",
] as const;

export type MailOutboxItemView = {
  sendOperationId: string;
  outboundRevisionId: string;
  mailboxId: string;
  authorizationMode: "admin_direct" | "staff_approved";
  status: (typeof OUTBOX_STATUSES)[number];
  subject: string;
  from: {
    address: string;
    displayName: string | null;
  };
  recipients: Array<{
    address: string;
    displayName: string | null;
    recipientType: string;
  }>;
  totalRecipientCount: number;
  createdAt: string;
  completedAt: string | null;
  nextAttemptAt: string | null;
  attachmentCount: number;
  hasAttachments: boolean;
  failureCode: "send_failed" | "dispatch_uncertain" | null;
  sourceMailbox?: MailSourceMailboxView;
};

export type MailOutboxListPage = {
  items: MailOutboxItemView[];
  nextCursor: string | null;
};

export type ListOutboxPageInput = {
  scope?: MailboxScope;
  mailboxId?: string | null;
  cursor?: string | null;
  limit?: number;
  search?: string | null;
};

type OutboxCursor = {
  createdAt: string;
  id: string;
  scope: MailboxScope | "legacy";
  mailboxId: string | null;
  search: string;
};

const OUTBOX_DEFAULT_LIMIT = 50;
const OUTBOX_MAX_LIMIT = 100;

function encodeOutboxCursor(cursor: OutboxCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeOutboxCursor(value: string): OutboxCursor | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<OutboxCursor>;
    if (
      typeof parsed.createdAt !== "string" ||
      typeof parsed.id !== "string" ||
      !["single", "all", "legacy"].includes(parsed.scope ?? "") ||
      (parsed.mailboxId !== null && typeof parsed.mailboxId !== "string") ||
      typeof parsed.search !== "string"
    ) {
      return null;
    }
    return parsed as OutboxCursor;
  } catch {
    return null;
  }
}

function outboxLimit(limit?: number): number {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) {
    return OUTBOX_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), OUTBOX_MAX_LIMIT);
}

export async function listOutboxPage(
  db: Database,
  actor: MailActorContext,
  input: ListOutboxPageInput = {},
): Promise<MailOutboxListPage> {
  assertEffectiveMailAccess(actor);
  const accessibleMailboxes = await listAccessibleMailboxes(db, actor);
  const accessibleMailboxIds = accessibleMailboxes.map((mailbox) => mailbox.id);
  const scope = input.scope ?? "legacy";

  if (scope === "all") {
    if (input.mailboxId) {
      throw MailServiceError.validation(
        "mailboxId cannot be used with scope=all",
      );
    }
    assertCanUseAllMailboxScope(actor);
  }
  if (scope === "single") {
    if (!input.mailboxId) {
      throw MailServiceError.validation("mailboxId is required");
    }
    if (!accessibleMailboxIds.includes(input.mailboxId)) {
      throw MailServiceError.forbidden("Outbox mailbox access denied");
    }
  } else if (
    scope === "legacy" &&
    input.mailboxId &&
    !accessibleMailboxIds.includes(input.mailboxId)
  ) {
    throw MailServiceError.forbidden("Outbox mailbox access denied");
  }
  if (accessibleMailboxIds.length === 0) {
    return { items: [], nextCursor: null };
  }

  const mailboxIds = input.mailboxId
    ? [input.mailboxId]
    : accessibleMailboxIds;
  const search = input.search?.trim() ?? "";
  const conditions = [
    inArray(schema.mailSendOperations.status, OUTBOX_STATUSES),
    inArray(schema.mailOutboundRevisions.mailboxId, mailboxIds),
  ];
  if (search) {
    const normalized = search.toLowerCase();
    conditions.push(
      or(
        sql`instr(lower(${schema.mailOutboundRevisions.subject}), ${normalized}) > 0`,
        sql`instr(lower(${schema.mailOutboundRevisions.fromAddress}), ${normalized}) > 0`,
        exists(
          db
            .select({ id: schema.mailOutboundRevisionRecipients.id })
            .from(schema.mailOutboundRevisionRecipients)
            .where(
              and(
                eq(
                  schema.mailOutboundRevisionRecipients.revisionId,
                  schema.mailOutboundRevisions.id,
                ),
                sql`instr(lower(${schema.mailOutboundRevisionRecipients.address}), ${normalized}) > 0`,
              ),
            ),
        ),
      )!,
    );
  }
  if (input.cursor) {
    const cursor = decodeOutboxCursor(input.cursor);
    if (
      !cursor ||
      cursor.scope !== scope ||
      cursor.mailboxId !== (input.mailboxId ?? null) ||
      cursor.search !== search
    ) {
      throw MailServiceError.validation("Invalid outbox list cursor");
    }
    conditions.push(
      or(
        lt(schema.mailSendOperations.createdAt, cursor.createdAt),
        and(
          eq(schema.mailSendOperations.createdAt, cursor.createdAt),
          lt(schema.mailSendOperations.id, cursor.id),
        ),
      )!,
    );
  }

  const limit = outboxLimit(input.limit);
  const sendRows = await db
    .select({
      send: schema.mailSendOperations,
      revision: schema.mailOutboundRevisions,
      sourceMailbox: {
        address: schema.mailMailboxes.address,
        displayName: schema.mailMailboxes.displayName,
        mailboxType: schema.mailMailboxes.mailboxType,
      },
    })
    .from(schema.mailSendOperations)
    .innerJoin(
      schema.mailOutboundRevisions,
      eq(
        schema.mailSendOperations.outboundRevisionId,
        schema.mailOutboundRevisions.id,
      ),
    )
    .innerJoin(
      schema.mailMailboxes,
      eq(
        schema.mailOutboundRevisions.mailboxId,
        schema.mailMailboxes.id,
      ),
    )
    .where(and(...conditions))
    .orderBy(
      desc(schema.mailSendOperations.createdAt),
      desc(schema.mailSendOperations.id),
    )
    .limit(limit + 1);

  const pageRows = sendRows.slice(0, limit);
  if (pageRows.length === 0) {
    return { items: [], nextCursor: null };
  }

  const revisionIds = pageRows.map(({ revision }) => revision.id);
  const [recipients, attachments] = await Promise.all([
    db
      .select()
      .from(schema.mailOutboundRevisionRecipients)
      .where(inArray(schema.mailOutboundRevisionRecipients.revisionId, revisionIds)),
    db
      .select({
        revisionId: schema.mailOutboundRevisionAttachments.revisionId,
        id: schema.mailOutboundRevisionAttachments.id,
      })
      .from(schema.mailOutboundRevisionAttachments)
      .where(inArray(schema.mailOutboundRevisionAttachments.revisionId, revisionIds)),
  ]);
  const recipientsByRevisionId = new Map<string, typeof recipients>();
  for (const recipient of recipients) {
    const current = recipientsByRevisionId.get(recipient.revisionId) ?? [];
    current.push(recipient);
    recipientsByRevisionId.set(recipient.revisionId, current);
  }
  const attachmentCountByRevisionId = new Map<string, number>();
  for (const attachment of attachments) {
    attachmentCountByRevisionId.set(
      attachment.revisionId,
      (attachmentCountByRevisionId.get(attachment.revisionId) ?? 0) + 1,
    );
  }

  const items = pageRows.map(({ send, revision, sourceMailbox }) => {
    const revisionRecipients = recipientsByRevisionId.get(revision.id) ?? [];
    const attachmentCount = attachmentCountByRevisionId.get(revision.id) ?? 0;
    const failureCode: MailOutboxItemView["failureCode"] =
      send.status === "failed"
        ? "send_failed"
        : send.status === "dispatch_uncertain"
          ? "dispatch_uncertain"
          : null;
    return {
      sendOperationId: send.id,
      outboundRevisionId: revision.id,
      mailboxId: revision.mailboxId,
      authorizationMode: send.authorizationMode,
      status: send.status as (typeof OUTBOX_STATUSES)[number],
      subject: revision.subject,
      from: {
        address: revision.fromAddress,
        displayName: revision.fromDisplayName,
      },
      recipients: revisionRecipients.map((recipient) => ({
        address: recipient.address,
        displayName: recipient.displayName,
        recipientType: recipient.recipientType,
      })),
      totalRecipientCount: revisionRecipients.length,
      createdAt: send.createdAt,
      completedAt: send.completedAt,
      nextAttemptAt: send.nextAttemptAt,
      attachmentCount,
      hasAttachments: attachmentCount > 0,
      failureCode,
      sourceMailbox,
    };
  });

  const last = pageRows[pageRows.length - 1]!.send;
  const nextCursor =
    sendRows.length > pageRows.length
      ? encodeOutboxCursor({
          createdAt: last.createdAt,
          id: last.id,
          scope,
          mailboxId: input.mailboxId ?? null,
          search,
        })
      : null;

  return { items, nextCursor };
}

export async function listOutboxItems(
  db: Database,
  actor: MailActorContext,
  input?: { mailboxId?: string | null },
): Promise<MailOutboxItemView[]> {
  assertEffectiveMailAccess(actor);
  const accessibleMailboxes = await listAccessibleMailboxes(db, actor);
  const accessibleMailboxIds = accessibleMailboxes.map((mailbox) => mailbox.id);

  if (input?.mailboxId && !accessibleMailboxIds.includes(input.mailboxId)) {
    throw MailServiceError.forbidden("Outbox mailbox access denied");
  }
  if (accessibleMailboxIds.length === 0) {
    return [];
  }

  const mailboxIds = input?.mailboxId
    ? [input.mailboxId]
    : accessibleMailboxIds;
  const sendRows = await db
    .select({
      send: schema.mailSendOperations,
      revision: schema.mailOutboundRevisions,
    })
    .from(schema.mailSendOperations)
    .innerJoin(
      schema.mailOutboundRevisions,
      eq(
        schema.mailSendOperations.outboundRevisionId,
        schema.mailOutboundRevisions.id,
      ),
    )
    .where(
      and(
        inArray(schema.mailSendOperations.status, OUTBOX_STATUSES),
        inArray(schema.mailOutboundRevisions.mailboxId, mailboxIds),
      ),
    )
    .orderBy(desc(schema.mailSendOperations.createdAt))
    .limit(100);

  if (sendRows.length === 0) {
    return [];
  }

  const revisionIds = sendRows.map(({ revision }) => revision.id);
  const [recipients, attachments] = await Promise.all([
    db
      .select()
      .from(schema.mailOutboundRevisionRecipients)
      .where(inArray(schema.mailOutboundRevisionRecipients.revisionId, revisionIds)),
    db
      .select({
        revisionId: schema.mailOutboundRevisionAttachments.revisionId,
        id: schema.mailOutboundRevisionAttachments.id,
      })
      .from(schema.mailOutboundRevisionAttachments)
      .where(inArray(schema.mailOutboundRevisionAttachments.revisionId, revisionIds)),
  ]);
  const recipientsByRevisionId = new Map<
    string,
    typeof recipients
  >();
  for (const recipient of recipients) {
    const current = recipientsByRevisionId.get(recipient.revisionId) ?? [];
    current.push(recipient);
    recipientsByRevisionId.set(recipient.revisionId, current);
  }
  const attachmentCountByRevisionId = new Map<string, number>();
  for (const attachment of attachments) {
    attachmentCountByRevisionId.set(
      attachment.revisionId,
      (attachmentCountByRevisionId.get(attachment.revisionId) ?? 0) + 1,
    );
  }

  return sendRows.map(({ send, revision }) => {
    const revisionRecipients = recipientsByRevisionId.get(revision.id) ?? [];
    const attachmentCount = attachmentCountByRevisionId.get(revision.id) ?? 0;
    return {
      sendOperationId: send.id,
      outboundRevisionId: revision.id,
      mailboxId: revision.mailboxId,
      authorizationMode: send.authorizationMode,
      status: send.status as (typeof OUTBOX_STATUSES)[number],
      subject: revision.subject,
      from: {
        address: revision.fromAddress,
        displayName: revision.fromDisplayName,
      },
      recipients: revisionRecipients.map((recipient) => ({
        address: recipient.address,
        displayName: recipient.displayName,
        recipientType: recipient.recipientType,
      })),
      totalRecipientCount: revisionRecipients.length,
      createdAt: send.createdAt,
      completedAt: send.completedAt,
      nextAttemptAt: send.nextAttemptAt,
      attachmentCount,
      hasAttachments: attachmentCount > 0,
      failureCode:
        send.status === "failed"
          ? "send_failed"
          : send.status === "dispatch_uncertain"
            ? "dispatch_uncertain"
            : null,
    };
  });
}
