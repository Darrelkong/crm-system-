import { and, desc, eq, inArray } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MailServiceError } from "@/lib/mail/errors";
import { assertEffectiveMailAccess } from "@/lib/permissions/mail";
import { listAccessibleMailboxes } from "@/lib/mail/mail-read-mailbox-service";

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
};

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
