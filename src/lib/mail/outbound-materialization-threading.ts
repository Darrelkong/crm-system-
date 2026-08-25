import { eq } from "drizzle-orm";
import type { MailComposeMode } from "../../../drizzle/schema/mail-drafts";
import type { MailMessage } from "../../../drizzle/schema/mail-messages";
import type { MailOutboundRevision } from "../../../drizzle/schema/mail-outbound-revisions";
import { schema, type Database } from "@/lib/db";
import {
  isRfcReplyComposeMode,
  shouldEmitRfcReplyHeaders,
  shouldJoinSourceThread,
} from "@/lib/mail/compose-mode-threading-semantics";
import { MailServiceError } from "@/lib/mail/errors";
import { buildOutboundRfcThreadingHeaders } from "@/lib/mail/outbound-rfc-threading";

export type OutboundThreadPlan = {
  threadId: string;
  createThread: boolean;
  outboundMailboxId: string;
};

export type OutboundMessageThreadingFields = {
  replyToMessageId: string | null;
  internetMessageId: string;
  inReplyTo: string | null;
  referencesHeader: string | null;
};

export function validateRevisionMaterializationComposeMode(
  revision: Pick<MailOutboundRevision, "composeMode" | "replyToMessageId">,
): void {
  if (isRfcReplyComposeMode(revision.composeMode)) {
    if (!revision.replyToMessageId?.trim()) {
      throw MailServiceError.validation(
        "Reply materialization requires source message provenance",
        { composeMode: revision.composeMode },
      );
    }
    return;
  }

  if (revision.composeMode === "new" && revision.replyToMessageId) {
    throw MailServiceError.validation(
      "New compose mode cannot materialize with reply provenance",
      { composeMode: revision.composeMode },
    );
  }
}

export async function loadSourceMessageForMaterialization(
  db: Database,
  sourceMessageId: string,
): Promise<MailMessage> {
  const [message] = await db
    .select()
    .from(schema.mailMessages)
    .where(eq(schema.mailMessages.id, sourceMessageId))
    .limit(1);
  if (!message) {
    throw MailServiceError.validation(
      "Source message not found for materialization",
      { sourceMessageId },
    );
  }
  return message;
}

/**
 * Resolves wire RFC Message-ID for threading from canonical message fields.
 * Outbound sources without internet_message_id may fall back to materialization RFC identity.
 */
export async function resolveSourceWireRfcMessageId(
  db: Database,
  source: Pick<
    MailMessage,
    "id" | "direction" | "internetMessageId"
  >,
): Promise<string | null> {
  if (source.internetMessageId?.trim()) {
    return source.internetMessageId.trim();
  }

  if (source.direction !== "outbound") {
    return null;
  }

  const [materialization] = await db
    .select({
      rfcMessageId: schema.mailOutboundMessageMaterializations.rfcMessageId,
      wireInternetMessageId:
        schema.mailOutboundMessageMaterializations.wireInternetMessageId,
    })
    .from(schema.mailOutboundMessageMaterializations)
    .where(
      eq(schema.mailOutboundMessageMaterializations.mailMessageId, source.id),
    )
    .limit(1);

  if (!materialization) {
    return null;
  }

  return (
    materialization.wireInternetMessageId ?? materialization.rfcMessageId ?? null
  );
}

export async function resolveOutboundThreadPlan(
  db: Database,
  input: {
    composeMode: MailComposeMode;
    sourceMessageId: string | null;
    outboundMailboxId: string;
  },
): Promise<OutboundThreadPlan> {
  if (!shouldJoinSourceThread(input.composeMode) || !input.sourceMessageId) {
    return {
      threadId: crypto.randomUUID(),
      createThread: true,
      outboundMailboxId: input.outboundMailboxId,
    };
  }

  const source = await loadSourceMessageForMaterialization(
    db,
    input.sourceMessageId,
  );

  if (source.mailboxId === input.outboundMailboxId) {
    const [thread] = await db
      .select({ id: schema.mailThreads.id, mailboxId: schema.mailThreads.mailboxId })
      .from(schema.mailThreads)
      .where(eq(schema.mailThreads.id, source.threadId))
      .limit(1);
    if (!thread || thread.mailboxId !== input.outboundMailboxId) {
      throw MailServiceError.integrityConflict(
        "Source thread mailbox invariant violation",
      );
    }
    return {
      threadId: source.threadId,
      createThread: false,
      outboundMailboxId: input.outboundMailboxId,
    };
  }

  return {
    threadId: crypto.randomUUID(),
    createThread: true,
    outboundMailboxId: input.outboundMailboxId,
  };
}

export async function resolveOutboundMessageThreadingFields(
  db: Database,
  input: {
    composeMode: MailComposeMode;
    sourceMessageId: string | null;
    outboundRfcMessageId: string;
  },
): Promise<OutboundMessageThreadingFields> {
  const canonicalReplyTo =
    isRfcReplyComposeMode(input.composeMode) && input.sourceMessageId
      ? input.sourceMessageId
      : null;

  if (!shouldEmitRfcReplyHeaders(input.composeMode) || !input.sourceMessageId) {
    return {
      replyToMessageId: canonicalReplyTo,
      internetMessageId: input.outboundRfcMessageId,
      inReplyTo: null,
      referencesHeader: null,
    };
  }

  const source = await loadSourceMessageForMaterialization(
    db,
    input.sourceMessageId,
  );
  const sourceWireId = await resolveSourceWireRfcMessageId(db, source);
  const { inReplyTo, referencesHeader } = buildOutboundRfcThreadingHeaders({
    sourceReferencesHeader: source.referencesHeader,
    sourceWireMessageId: sourceWireId,
  });

  return {
    replyToMessageId: canonicalReplyTo,
    internetMessageId: input.outboundRfcMessageId,
    inReplyTo,
    referencesHeader,
  };
}

export function revisionSourceMessageIdForThreading(
  revision: Pick<MailOutboundRevision, "composeMode" | "replyToMessageId">,
): string | null {
  if (isRfcReplyComposeMode(revision.composeMode)) {
    return revision.replyToMessageId;
  }
  return null;
}
