import { asc, eq } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import {
  listComposeContextOptions,
  type ComposeContextOptionView,
} from "@/lib/mail/compose-context-service";
import {
  deriveSeedRecipients,
  type VisibleSourceRecipient,
} from "@/lib/mail/compose-draft-recipient-derivation";
import type { ComposeDraftSeedMode } from "@/lib/mail/compose-draft-seed-parsing";
import {
  buildForwardQuoteBody,
  buildReplyQuoteBody,
  type SourceQuoteBody,
} from "@/lib/mail/compose-draft-quote";
import {
  forwardSubject,
  replySubject,
} from "@/lib/mail/compose-subject-utils";
import { createSeededDraft, type DraftDetailView } from "@/lib/mail/draft-service";
import { MailServiceError } from "@/lib/mail/errors";
import { resolveMessageCustomerAssociation } from "@/lib/mail/mail-customer-context-resolver";
import type { MailMessageReadFolder } from "@/lib/mail/message-read-permissions";
import {
  assertCanReadMessageForPublicApi,
  buildRecipientVisibilityContext,
  filterRecipientsForViewer,
  type MailMessageReadPermissionResult,
} from "@/lib/mail/message-read-permissions";

export type CreateSeededComposeDraftInput = {
  sourceMessageId: string;
  mode: ComposeDraftSeedMode;
  folder?: MailMessageReadFolder;
};

/**
 * Reply-All self exclusion: only the resolved/default From identity when unambiguous.
 * When From is ambiguous, exclude nothing so unrelated authorized identities remain.
 */
export function resolveSeedSelfExclusionAddresses(
  selectedIdentity: Pick<ComposeContextOptionView, "address"> | null,
): string[] {
  return selectedIdentity ? [selectedIdentity.address] : [];
}

function resolveDefaultSenderIdentity(
  options: ComposeContextOptionView[],
  sourceMailboxId: string,
): ComposeContextOptionView | null {
  if (options.length === 0) {
    return null;
  }

  const mailboxMatches = options.filter(
    (option) => option.mailboxId === sourceMailboxId,
  );
  if (mailboxMatches.length === 1) {
    return mailboxMatches[0]!;
  }

  if (options.length === 1) {
    return options[0]!;
  }

  return null;
}

function resolveSubject(
  mode: ComposeDraftSeedMode,
  sourceSubject: string,
): string {
  if (mode === "forward") {
    return forwardSubject(sourceSubject);
  }
  return replySubject(sourceSubject);
}

async function loadSourceQuoteBody(
  db: Database,
  messageId: string,
): Promise<SourceQuoteBody> {
  const [body] = await db
    .select()
    .from(schema.mailMessageBodies)
    .where(eq(schema.mailMessageBodies.messageId, messageId))
    .limit(1);

  if (!body) {
    throw MailServiceError.notFound("Message body not found");
  }

  return {
    bodyText: body.bodyText,
    bodyHtmlSanitized: body.bodyHtmlSanitized,
    quotedText: body.quotedText,
    quotedHtmlSanitized: body.quotedHtmlSanitized,
  };
}

async function loadVisibleSourceRecipients(
  db: Database,
  actor: MailActorContext,
  message: MailMessageReadPermissionResult["message"],
  mailboxAccess: MailMessageReadPermissionResult["mailboxAccess"],
): Promise<VisibleSourceRecipient[]> {
  const recipientRows = await db
    .select({
      recipientType: schema.mailMessageRecipients.recipientType,
      address: schema.mailMessageRecipients.address,
      displayName: schema.mailMessageRecipients.displayName,
      sortOrder: schema.mailMessageRecipients.sortOrder,
    })
    .from(schema.mailMessageRecipients)
    .where(eq(schema.mailMessageRecipients.messageId, message.id))
    .orderBy(asc(schema.mailMessageRecipients.sortOrder));

  const visibilityContext = buildRecipientVisibilityContext(
    actor,
    message,
    mailboxAccess,
  );

  return filterRecipientsForViewer(recipientRows, visibilityContext).map(
    (recipient) => ({
      recipientType: recipient.recipientType,
      address: recipient.address,
      displayName: recipient.displayName,
      sortOrder: recipient.sortOrder,
    }),
  );
}

async function resolveInheritedCustomerAssociation(
  db: Database,
  actor: MailActorContext,
  message: MailMessageReadPermissionResult["message"],
  mode: ComposeDraftSeedMode,
) {
  if (mode === "forward") {
    return undefined;
  }

  const association = await resolveMessageCustomerAssociation(db, actor, message);
  if (!association) {
    return undefined;
  }

  const now = new Date().toISOString();
  return {
    customerId: association.customerId,
    customerAssociationType: association.associationType,
    customerAssociatedByUserId:
      association.associationType === "manual" ? actor.userId : null,
    customerAssociatedAt: now,
  } satisfies NonNullable<
    Parameters<typeof createSeededDraft>[2]["customerAssociation"]
  >;
}

export async function createSeededComposeDraft(
  db: Database,
  actor: MailActorContext,
  input: CreateSeededComposeDraftInput,
): Promise<DraftDetailView> {
  const { message, mailboxAccess } = await assertCanReadMessageForPublicApi(
    db,
    actor,
    input.sourceMessageId,
    input.folder ? { folder: input.folder } : undefined,
  );

  const [sourceBody, visibleRecipients, composeOptions] = await Promise.all([
    loadSourceQuoteBody(db, message.id),
    loadVisibleSourceRecipients(db, actor, message, mailboxAccess),
    listComposeContextOptions(db, actor),
  ]);

  const selectedIdentity = resolveDefaultSenderIdentity(
    composeOptions,
    message.mailboxId,
  );
  const selfAddresses = resolveSeedSelfExclusionAddresses(selectedIdentity);

  const { recipients } = deriveSeedRecipients({
    mode: input.mode,
    message,
    visibleRecipients,
    selfAddresses,
  });

  const quoteBody =
    input.mode === "forward"
      ? buildForwardQuoteBody({
          message,
          visibleRecipients,
          source: sourceBody,
        })
      : buildReplyQuoteBody({
          message,
          source: sourceBody,
        });

  const customerAssociation = await resolveInheritedCustomerAssociation(
    db,
    actor,
    message,
    input.mode,
  );

  return createSeededDraft(db, actor, {
    composeMode: input.mode,
    // Source provenance for all seeded modes. Phase 6C threading/RFC uses composeMode,
    // not replyToMessageId alone — see compose-mode-threading-semantics.ts.
    replyToMessageId: message.id,
    senderIdentityId: selectedIdentity?.senderIdentityId ?? null,
    mailboxId: selectedIdentity?.mailboxId ?? null,
    subject: resolveSubject(input.mode, message.subject),
    bodyText: quoteBody.bodyText,
    bodyHtml: quoteBody.bodyHtml,
    recipients,
    customerAssociation,
  });
}
