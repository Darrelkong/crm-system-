import { and, asc, desc, eq } from "drizzle-orm";
import type { MailMessage } from "../../../drizzle/schema/mail-messages";
import type { MailOutboundMessageMaterialization } from "../../../drizzle/schema/mail-outbound-message-materializations";
import type { MailOutboundRevision } from "../../../drizzle/schema/mail-outbound-revisions";
import type { MailOutboundRfcIdentity } from "../../../drizzle/schema/mail-outbound-rfc-identities";
import type { MailSendOperation } from "../../../drizzle/schema/mail-send-operations";
import type { MailTransportAttempt } from "../../../drizzle/schema/mail-transport-attempts";
import { schema, type Database } from "@/lib/db";
import { normalizeSubject } from "@/lib/mail/canonical-content-hash-v1-contract";
import {
  CANONICAL_CONTENT_HASH_VERSION,
  MAIL_AUDIT_ACTIONS,
} from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import {
  buildInvalidMaterializationPostStateGuardedAuditInsert,
  buildMaterializationGuardedInsert,
  buildMaterializationPostStateGuardedAuditInsert,
  isMailPostStateGuardError,
  runMailBatch,
  type MaterializationPostStateGuard,
} from "@/lib/mail/guarded-batch";
import { recomputeOutboundRevisionContentHash } from "@/lib/mail/outbound-revision-service";
import {
  assertRecipientSemanticSetsEqual,
  type RecipientSemanticRow,
} from "@/lib/mail/recipient-semantic-equality";
import { resolveSentMaterializationMailboxId } from "@/lib/mail/sent-mailbox-placement";
import {
  isRfcReplyComposeMode,
} from "@/lib/mail/compose-mode-threading-semantics";
import {
  resolveOutboundMessageThreadingFields,
  resolveOutboundThreadPlan,
  revisionSourceMessageIdForThreading,
  validateRevisionMaterializationComposeMode,
} from "@/lib/mail/outbound-materialization-threading";
import {
  toSafeMaterializationView,
  type SafeMaterializationView,
} from "@/lib/mail/sent-message-materialization-serialization";

const SUPPORTED_COMPOSE_MODES = new Set([
  "new",
  "reply",
  "reply_all",
  "forward",
]);

export type MaterializeAcceptedOutboundSendResult = {
  materialization: MailOutboundMessageMaterialization;
  message: MailMessage;
  threadId: string;
  mailboxId: string;
  view: SafeMaterializationView;
};

function buildPreviewText(bodyText: string, subject: string): string {
  const source = bodyText.trim() || subject.trim();
  if (source.length <= 200) {
    return source;
  }
  return `${source.slice(0, 197)}...`;
}

function assertWireIdentityConsistency(
  materialization: MailOutboundMessageMaterialization,
  message: MailMessage,
): void {
  const wire = materialization.wireInternetMessageId;
  if (wire == null) {
    if (message.internetMessageId !== null) {
      throw MailServiceError.integrityConflict(
        "Existing materialization wire identity unknown but message has internet message id",
      );
    }
    return;
  }
  if (message.internetMessageId !== wire) {
    throw MailServiceError.integrityConflict(
      "Existing materialization wire identity mismatch",
    );
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /UNIQUE constraint failed/i.test(message);
}

async function findSendById(
  db: Database,
  sendOperationId: string,
): Promise<MailSendOperation | null> {
  const [row] = await db
    .select()
    .from(schema.mailSendOperations)
    .where(eq(schema.mailSendOperations.id, sendOperationId))
    .limit(1);
  return row ?? null;
}

async function findMaterializationBySendId(
  db: Database,
  sendOperationId: string,
): Promise<MailOutboundMessageMaterialization | null> {
  const [row] = await db
    .select()
    .from(schema.mailOutboundMessageMaterializations)
    .where(
      eq(schema.mailOutboundMessageMaterializations.sendOperationId, sendOperationId),
    )
    .limit(1);
  return row ?? null;
}

async function findAcceptedTransportAttempt(
  db: Database,
  sendOperationId: string,
): Promise<MailTransportAttempt | null> {
  const [attempt] = await db
    .select()
    .from(schema.mailTransportAttempts)
    .where(
      and(
        eq(schema.mailTransportAttempts.sendOperationId, sendOperationId),
        eq(schema.mailTransportAttempts.state, "accepted"),
      ),
    )
    .orderBy(desc(schema.mailTransportAttempts.attemptNumber))
    .limit(1);
  return attempt ?? null;
}

async function findRfcIdentity(
  db: Database,
  sendOperationId: string,
): Promise<MailOutboundRfcIdentity | null> {
  const [row] = await db
    .select()
    .from(schema.mailOutboundRfcIdentities)
    .where(eq(schema.mailOutboundRfcIdentities.sendOperationId, sendOperationId))
    .limit(1);
  return row ?? null;
}

async function assertRevisionHashIntegrity(
  db: Database,
  revision: MailOutboundRevision,
): Promise<void> {
  const recomputed = await recomputeOutboundRevisionContentHash(db, revision.id);
  if (recomputed.hashVersion !== CANONICAL_CONTENT_HASH_VERSION) {
    throw MailServiceError.integrityConflict("Unsupported hash version");
  }
  if (
    recomputed.contentHash !== revision.contentHash ||
    recomputed.hashVersion !== revision.hashVersion
  ) {
    throw MailServiceError.integrityConflict(
      "Outbound revision content hash integrity conflict",
    );
  }
}

async function loadRevisionGraph(db: Database, revisionId: string) {
  const [revision] = await db
    .select()
    .from(schema.mailOutboundRevisions)
    .where(eq(schema.mailOutboundRevisions.id, revisionId))
    .limit(1);
  if (!revision) {
    throw MailServiceError.notFound("Outbound revision not found");
  }

  const recipients = await db
    .select()
    .from(schema.mailOutboundRevisionRecipients)
    .where(eq(schema.mailOutboundRevisionRecipients.revisionId, revision.id))
    .orderBy(
      asc(schema.mailOutboundRevisionRecipients.sortOrder),
      asc(schema.mailOutboundRevisionRecipients.createdAt),
    );

  const attachments = await db
    .select()
    .from(schema.mailOutboundRevisionAttachments)
    .where(eq(schema.mailOutboundRevisionAttachments.revisionId, revision.id))
    .orderBy(asc(schema.mailOutboundRevisionAttachments.sortOrder));

  return { revision, recipients, attachments };
}

async function loadMessageRecipientSemantics(
  db: Database,
  messageId: string,
): Promise<RecipientSemanticRow[]> {
  const rows = await db
    .select()
    .from(schema.mailMessageRecipients)
    .where(eq(schema.mailMessageRecipients.messageId, messageId))
    .orderBy(
      asc(schema.mailMessageRecipients.sortOrder),
      asc(schema.mailMessageRecipients.createdAt),
    );
  return rows.map((row) => ({
    recipientType: row.recipientType,
    address: row.address,
    displayName: row.displayName,
    sortOrder: row.sortOrder,
  }));
}

async function verifyExistingMaterializationSemantics(
  db: Database,
  input: {
    send: MailSendOperation;
    materialization: MailOutboundMessageMaterialization;
    rfcIdentity: MailOutboundRfcIdentity;
    acceptedAttempt: MailTransportAttempt;
    revision: MailOutboundRevision;
    revisionRecipients: RecipientSemanticRow[];
  },
): Promise<MaterializeAcceptedOutboundSendResult> {
  const {
    send,
    materialization,
    rfcIdentity,
    acceptedAttempt,
    revision,
    revisionRecipients,
  } = input;

  if (materialization.outboundRevisionId !== send.outboundRevisionId) {
    throw MailServiceError.integrityConflict(
      "Existing materialization revision provenance mismatch",
    );
  }
  if (
    materialization.contentHash !== send.contentHash ||
    materialization.hashVersion !== send.hashVersion
  ) {
    throw MailServiceError.integrityConflict(
      "Existing materialization hash provenance mismatch",
    );
  }
  if (materialization.acceptedTransportAttemptId !== acceptedAttempt.id) {
    throw MailServiceError.integrityConflict(
      "Existing materialization transport attempt provenance mismatch",
    );
  }
  if (materialization.outboundRfcIdentityId !== rfcIdentity.id) {
    throw MailServiceError.integrityConflict(
      "Existing materialization RFC identity provenance mismatch",
    );
  }
  if (materialization.rfcMessageId !== rfcIdentity.rfcMessageId) {
    throw MailServiceError.integrityConflict(
      "Existing materialization internal RFC identity mismatch",
    );
  }

  const [message] = await db
    .select()
    .from(schema.mailMessages)
    .where(eq(schema.mailMessages.id, materialization.mailMessageId))
    .limit(1);
  if (!message) {
    throw MailServiceError.integrityConflict(
      "Existing materialization references missing mail message",
    );
  }
  if (message.direction !== "outbound") {
    throw MailServiceError.integrityConflict(
      "Existing materialization message direction mismatch",
    );
  }
  assertWireIdentityConsistency(materialization, message);
  if (message.senderIdentityId !== revision.senderIdentityId) {
    throw MailServiceError.integrityConflict(
      "Existing materialization sender identity mismatch",
    );
  }

  const messageRecipients = await loadMessageRecipientSemantics(
    db,
    message.id,
  );
  assertRecipientSemanticSetsEqual(revisionRecipients, messageRecipients);

  const view = toSafeMaterializationView(materialization, message, {
    recipientCount: messageRecipients.length,
    attachmentCount: await db
      .select({ id: schema.mailMessageAttachments.id })
      .from(schema.mailMessageAttachments)
      .where(eq(schema.mailMessageAttachments.messageId, message.id))
      .then((rows) => rows.length),
  });

  return {
    materialization,
    message,
    threadId: message.threadId,
    mailboxId: message.mailboxId,
    view,
  };
}

async function createMaterializationGraph(
  db: Database,
  input: {
    send: MailSendOperation;
    revision: MailOutboundRevision;
    recipients: RecipientSemanticRow[];
    attachments: Array<{
      id: string;
      storedFileId: string;
      contentHash: string;
      originalFilename: string;
      displayFilename: string;
      mimeType: string;
      sizeBytes: number;
      sortOrder: number;
      deliveryMode: "direct_attachment" | "secure_file";
      secureExpiryDays: number | null;
    }>;
    rfcIdentity: MailOutboundRfcIdentity;
    acceptedAttempt: MailTransportAttempt;
    sentMailboxId: string;
    threadPlan: {
      threadId: string;
      createThread: boolean;
    };
    threadingFields: {
      replyToMessageId: string | null;
      internetMessageId: string;
      inReplyTo: string | null;
      referencesHeader: string | null;
    };
  },
): Promise<MaterializeAcceptedOutboundSendResult> {
  const now = new Date().toISOString();
  const sentAt =
    input.send.completedAt ?? input.acceptedAttempt.completedAt ?? now;
  const materializedAt = now;
  const messageId = crypto.randomUUID();
  const materializationId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const subjectNormalized = normalizeSubject(input.revision.subject);
  const { threadId } = input.threadPlan;

  const postGuard: MaterializationPostStateGuard = {
    sendOperationId: input.send.id,
    outboundRevisionId: input.revision.id,
    contentHash: input.send.contentHash,
    hashVersion: input.send.hashVersion,
    acceptedTransportAttemptId: input.acceptedAttempt.id,
  };

  const threadStatements = input.threadPlan.createThread
    ? [
        db.insert(schema.mailThreads).values({
          id: threadId,
          mailboxId: input.sentMailboxId,
          subjectNormalized,
          lastMessageAt: sentAt,
          createdAt: now,
          updatedAt: now,
        }),
      ]
    : [
        db
          .update(schema.mailThreads)
          .set({
            lastMessageAt: sentAt,
            updatedAt: now,
          })
          .where(eq(schema.mailThreads.id, threadId)),
      ];

  const statements = [
    ...threadStatements,
    db.insert(schema.mailMessages).values({
      id: messageId,
      threadId,
      mailboxId: input.sentMailboxId,
      direction: "outbound",
      senderIdentityId: input.revision.senderIdentityId,
      fromAddress: input.revision.fromAddress,
      fromDisplayName: input.revision.fromDisplayName,
      subject: input.revision.subject,
      subjectNormalized,
      previewText: buildPreviewText(
        input.revision.bodyText,
        input.revision.subject,
      ),
      sensitivity: input.revision.sensitivity,
      internetMessageId: input.threadingFields.internetMessageId,
      inReplyTo: input.threadingFields.inReplyTo,
      referencesHeader: input.threadingFields.referencesHeader,
      replyToMessageId: input.threadingFields.replyToMessageId,
      composeMode: input.revision.composeMode,
      receivedAt: null,
      sentAt,
      trashedAt: null,
      trashedBy: null,
      createdBy: input.revision.createdByUserId,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(schema.mailMessageBodies).values({
      messageId,
      bodyText: input.revision.bodyText,
      bodyHtmlSanitized: input.revision.bodyHtmlSanitized,
      quotedText: null,
      quotedHtmlSanitized: null,
      sanitizationVersion: "1",
      createdAt: now,
      updatedAt: now,
    }),
    ...input.recipients.map((recipient) =>
      db.insert(schema.mailMessageRecipients).values({
        id: crypto.randomUUID(),
        messageId,
        recipientType: recipient.recipientType,
        address: recipient.address,
        displayName: recipient.displayName,
        sortOrder: recipient.sortOrder,
        createdAt: now,
      }),
    ),
    ...input.attachments.map((attachment) =>
      db.insert(schema.mailMessageAttachments).values({
        id: crypto.randomUUID(),
        messageId,
        storedFileId: attachment.storedFileId,
        sourceRevisionAttachmentId: attachment.id,
        contentHash: attachment.contentHash,
        originalFilename: attachment.originalFilename,
        displayFilename: attachment.displayFilename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        sortOrder: attachment.sortOrder,
        deliveryMode: attachment.deliveryMode,
        secureExpiryDays: attachment.secureExpiryDays,
        createdAt: now,
      }),
    ),
    buildMaterializationGuardedInsert(db, postGuard, {
      id: materializationId,
      outboundRfcIdentityId: input.rfcIdentity.id,
      rfcMessageId: input.rfcIdentity.rfcMessageId,
      wireInternetMessageId: input.threadingFields.internetMessageId,
      mailMessageId: messageId,
      materializedAt,
    }),
    buildMaterializationPostStateGuardedAuditInsert(db, {
      auditId,
      userId: input.send.initiatedByUserId ?? input.revision.createdByUserId,
      now,
      action: MAIL_AUDIT_ACTIONS.sentMaterialized,
      sendOperationId: input.send.id,
      mailMessageId: messageId,
      metadata: {
        sendOperationId: input.send.id,
        transportAttemptId: input.acceptedAttempt.id,
        revisionId: input.revision.id,
        messageId,
        threadId,
        mailboxId: input.sentMailboxId,
        rfcMessageId: input.rfcIdentity.rfcMessageId,
        recipientCount: input.recipients.length,
        attachmentCount: input.attachments.length,
      },
    }),
  ];

  try {
    await runMailBatch(db, statements);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const existing = await findMaterializationBySendId(db, input.send.id);
      if (existing) {
        return verifyExistingMaterializationSemantics(db, {
          send: input.send,
          materialization: existing,
          rfcIdentity: input.rfcIdentity,
          acceptedAttempt: input.acceptedAttempt,
          revision: input.revision,
          revisionRecipients: input.recipients,
        });
      }
    }
    throw error;
  }

  const [materialization] = await db
    .select()
    .from(schema.mailOutboundMessageMaterializations)
    .where(eq(schema.mailOutboundMessageMaterializations.id, materializationId))
    .limit(1);
  const [message] = await db
    .select()
    .from(schema.mailMessages)
    .where(eq(schema.mailMessages.id, messageId))
    .limit(1);
  if (!materialization || !message) {
    throw MailServiceError.conflict("Materialization graph creation failed");
  }

  const messageRecipients = await loadMessageRecipientSemantics(db, messageId);
  assertRecipientSemanticSetsEqual(input.recipients, messageRecipients);

  return {
    materialization,
    message,
    threadId,
    mailboxId: input.sentMailboxId,
    view: toSafeMaterializationView(materialization, message, {
      recipientCount: messageRecipients.length,
      attachmentCount: input.attachments.length,
    }),
  };
}

/**
 * Materializes a canonical outbound Sent message from an accepted Send Operation.
 * Internal/system service — caller supplies only sendOperationId.
 */
export async function materializeAcceptedOutboundSend(
  db: Database,
  sendOperationId: string,
): Promise<MaterializeAcceptedOutboundSendResult> {
  const send = await findSendById(db, sendOperationId);
  if (!send) {
    throw MailServiceError.notFound("Send operation not found");
  }
  if (send.status !== "accepted") {
    throw MailServiceError.validation(
      "Only accepted send operations may materialize canonical Sent messages",
      { status: send.status },
    );
  }

  const acceptedAttempt = await findAcceptedTransportAttempt(db, send.id);
  if (!acceptedAttempt) {
    throw MailServiceError.validation(
      "Accepted transport attempt required for materialization",
    );
  }
  if (acceptedAttempt.sendOperationId !== send.id) {
    throw MailServiceError.integrityConflict(
      "Transport attempt does not belong to send operation",
    );
  }

  const rfcIdentity = await findRfcIdentity(db, send.id);
  if (!rfcIdentity) {
    throw MailServiceError.integrityConflict(
      "Send operation missing stable RFC Message-ID",
    );
  }
  if (rfcIdentity.outboundRevisionId !== send.outboundRevisionId) {
    throw MailServiceError.integrityConflict(
      "RFC identity revision provenance mismatch",
    );
  }

  const { revision, recipients, attachments } = await loadRevisionGraph(
    db,
    send.outboundRevisionId,
  );
  if (revision.id !== send.outboundRevisionId) {
    throw MailServiceError.integrityConflict("Revision provenance mismatch");
  }
  if (
    revision.contentHash !== send.contentHash ||
    revision.hashVersion !== send.hashVersion
  ) {
    throw MailServiceError.integrityConflict(
      "Send operation hash provenance does not match revision",
    );
  }
  if (!SUPPORTED_COMPOSE_MODES.has(revision.composeMode)) {
    throw MailServiceError.validation(
      "Unsupported compose mode for Sent materialization",
      { composeMode: revision.composeMode },
    );
  }

  validateRevisionMaterializationComposeMode(revision);
  await assertRevisionHashIntegrity(db, revision);

  const [identity] = await db
    .select()
    .from(schema.mailSenderIdentities)
    .where(eq(schema.mailSenderIdentities.id, revision.senderIdentityId))
    .limit(1);
  if (!identity) {
    throw MailServiceError.integrityConflict("Sender identity not found");
  }

  const sentMailboxId = resolveSentMaterializationMailboxId(identity);
  const sourceMessageId = revisionSourceMessageIdForThreading(revision);
  const threadPlan = await resolveOutboundThreadPlan(db, {
    composeMode: revision.composeMode,
    sourceMessageId,
    outboundMailboxId: sentMailboxId,
  });
  const threadingFields = await resolveOutboundMessageThreadingFields(db, {
    composeMode: revision.composeMode,
    sourceMessageId: isRfcReplyComposeMode(revision.composeMode)
      ? revision.replyToMessageId
      : null,
    outboundRfcMessageId: rfcIdentity.rfcMessageId,
  });
  const revisionRecipients: RecipientSemanticRow[] = recipients.map((row) => ({
    recipientType: row.recipientType,
    address: row.address,
    displayName: row.displayName,
    sortOrder: row.sortOrder,
  }));

  const existing = await findMaterializationBySendId(db, send.id);
  if (existing) {
    return verifyExistingMaterializationSemantics(db, {
      send,
      materialization: existing,
      rfcIdentity,
      acceptedAttempt,
      revision,
      revisionRecipients,
    });
  }

  return createMaterializationGraph(db, {
    send,
    revision,
    recipients: revisionRecipients,
    attachments,
    rfcIdentity,
    acceptedAttempt,
    sentMailboxId,
    threadPlan,
    threadingFields,
  });
}

/** Test-only helper to exercise guarded batch rollback semantics. */
export async function attemptInvalidMaterializationBatch(
  db: Database,
  sendOperationId: string,
): Promise<void> {
  const send = await findSendById(db, sendOperationId);
  if (!send || send.status !== "accepted") {
    throw MailServiceError.validation("Accepted send required");
  }

  const acceptedAttempt = await findAcceptedTransportAttempt(db, send.id);
  const rfcIdentity = await findRfcIdentity(db, send.id);
  const { revision, recipients, attachments } = await loadRevisionGraph(
    db,
    send.outboundRevisionId,
  );
  if (!acceptedAttempt || !rfcIdentity) {
    throw MailServiceError.integrityConflict("Missing send provenance");
  }

  const [identity] = await db
    .select()
    .from(schema.mailSenderIdentities)
    .where(eq(schema.mailSenderIdentities.id, revision.senderIdentityId))
    .limit(1);
  if (!identity) {
    throw MailServiceError.integrityConflict("Sender identity not found");
  }

  const sentMailboxId = resolveSentMaterializationMailboxId(identity);
  const now = new Date().toISOString();
  const sentAt = send.completedAt ?? acceptedAttempt.completedAt ?? now;
  const threadId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const materializationId = crypto.randomUUID();
  const subjectNormalized = normalizeSubject(revision.subject);

  const postGuard: MaterializationPostStateGuard = {
    sendOperationId: send.id,
    outboundRevisionId: revision.id,
    contentHash: send.contentHash,
    hashVersion: send.hashVersion,
    acceptedTransportAttemptId: acceptedAttempt.id,
  };

  const revisionRecipients: RecipientSemanticRow[] = recipients.map((row) => ({
    recipientType: row.recipientType,
    address: row.address,
    displayName: row.displayName,
    sortOrder: row.sortOrder,
  }));

  await runMailBatch(db, [
    db.insert(schema.mailThreads).values({
      id: threadId,
      mailboxId: sentMailboxId,
      subjectNormalized,
      lastMessageAt: sentAt,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(schema.mailMessages).values({
      id: messageId,
      threadId,
      mailboxId: sentMailboxId,
      direction: "outbound",
      senderIdentityId: revision.senderIdentityId,
      fromAddress: revision.fromAddress,
      fromDisplayName: revision.fromDisplayName,
      subject: revision.subject,
      subjectNormalized,
      previewText: buildPreviewText(revision.bodyText, revision.subject),
      sensitivity: revision.sensitivity,
      internetMessageId: null,
      composeMode: revision.composeMode,
      sentAt,
      createdBy: revision.createdByUserId,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(schema.mailMessageBodies).values({
      messageId,
      bodyText: revision.bodyText,
      bodyHtmlSanitized: revision.bodyHtmlSanitized,
      sanitizationVersion: "1",
      createdAt: now,
      updatedAt: now,
    }),
    ...revisionRecipients.map((recipient) =>
      db.insert(schema.mailMessageRecipients).values({
        id: crypto.randomUUID(),
        messageId,
        recipientType: recipient.recipientType,
        address: recipient.address,
        displayName: recipient.displayName,
        sortOrder: recipient.sortOrder,
        createdAt: now,
      }),
    ),
    ...attachments.map((attachment) =>
      db.insert(schema.mailMessageAttachments).values({
        id: crypto.randomUUID(),
        messageId,
        storedFileId: attachment.storedFileId,
        sourceRevisionAttachmentId: attachment.id,
        contentHash: attachment.contentHash,
        originalFilename: attachment.originalFilename,
        displayFilename: attachment.displayFilename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        sortOrder: attachment.sortOrder,
        deliveryMode: attachment.deliveryMode,
        secureExpiryDays: attachment.secureExpiryDays,
        createdAt: now,
      }),
    ),
    buildMaterializationGuardedInsert(db, postGuard, {
      id: materializationId,
      outboundRfcIdentityId: rfcIdentity.id,
      rfcMessageId: rfcIdentity.rfcMessageId,
      wireInternetMessageId: null,
      mailMessageId: messageId,
      materializedAt: now,
    }),
    buildInvalidMaterializationPostStateGuardedAuditInsert(db, {
      auditId: crypto.randomUUID(),
      userId: send.initiatedByUserId ?? revision.createdByUserId,
      now,
      action: MAIL_AUDIT_ACTIONS.sentMaterialized,
      sendOperationId: send.id,
      metadata: {},
    }),
  ]);
}

export const sentMessageMaterializationTestHooks =
  process.env.CRM_ALLOW_TEST_DB_BIND === "1"
    ? {
        attemptInvalidMaterializationBatch,
        findMaterializationBySendId,
        isMailPostStateGuardError,
        assertWireIdentityConsistency,
      }
    : undefined;
