import { and, asc, eq } from "drizzle-orm";
import type { MailInboundIngestionEvent } from "../../../drizzle/schema/mail-inbound-ingestion-events";
import type { MailInboundMessageMaterialization } from "../../../drizzle/schema/mail-inbound-message-materializations";
import type { MailMessage } from "../../../drizzle/schema/mail-messages";
import type { MailProviderIngestionEvent } from "../../../drizzle/schema/mail-provider-ingestion-events";
import { schema, type Database } from "@/lib/db";
import { MAIL_ERROR_CODES, MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import type { InboundAttachmentStore } from "@/lib/mail/inbound-attachment-store";
import {
  assertInboundCanonicalSemanticGraphsEqual,
  inboundSemanticGraphFromParsedMime,
  type InboundCanonicalSemanticGraph,
} from "@/lib/mail/inbound-canonical-semantic";
import { INBOUND_BODY_HTML_SANITIZER_POLICY_VERSION } from "@/lib/mail/inbound-body-html-sanitizer";
import {
  INBOUND_MATERIALIZATION_FALLBACK_REASONS,
  INBOUND_QUARANTINE_REASONS,
} from "@/lib/mail/inbound-quarantine-reasons";
import { computeInboundPayloadContentHash } from "@/lib/mail/inbound-payload-hash";
import { findFirstInboundDangerousAttachmentViolation } from "@/lib/mail/inbound-dangerous-attachment-policy";
import { parseInboundMimeBytes } from "@/lib/mail/inbound-mime-parser";
import type { InboundRawPayloadStore } from "@/lib/mail/inbound-raw-payload-store";
import { resolveInboundThread } from "@/lib/mail/inbound-thread-resolution";
import {
  assertBatchUpdateChanged,
  buildInboundMaterializationGuardedAuditInsert,
  buildInboundMaterializationGuardedInsert,
  buildInboundProviderCompletedCasUpdate,
  buildInboundProviderQuarantineUpdate,
  runGuardedUpdate,
  runMailBatch,
  type InboundMaterializationPostStateGuard,
} from "@/lib/mail/guarded-batch";
import { claimProviderIngestionForProcessing } from "@/lib/mail/provider-ingestion-claim";
import { buildResolvedNotificationIntentInsert } from "@/lib/mail/notification-outbox-batch-enqueue";
import {
  resolveNewIncomingNotificationTarget,
  type ResolvedNotificationTarget,
} from "@/lib/mail/notification-source-recipient-resolution";
import { MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES } from "@/lib/mail/notification-source-entity-policy";

export type MaterializeInboundIngestionEventResult = {
  materialization: MailInboundMessageMaterialization;
  message: MailMessage;
  threadId: string;
  mailboxId: string;
  convergedExistingMessage: boolean;
};

type MaterializationDeps = {
  rawPayloadStore: InboundRawPayloadStore;
  attachmentStore: InboundAttachmentStore;
};

function resolveQuarantineReason(error: MailServiceError): string {
  if (error.message.includes("RFC Message-ID collision")) {
    return INBOUND_QUARANTINE_REASONS.rfcMessageIdCollision;
  }
  if (error.message.toLowerCase().includes("raw payload")) {
    return INBOUND_QUARANTINE_REASONS.payloadIntegrityConflict;
  }
  if (error.message.includes("MIME")) {
    return INBOUND_QUARANTINE_REASONS.mimeParseFailure;
  }
  if (error.message.toLowerCase().includes("sender")) {
    return INBOUND_QUARANTINE_REASONS.senderInvariantFailure;
  }
  if (error.message.toLowerCase().includes("mailbox")) {
    return INBOUND_QUARANTINE_REASONS.materializationTargetUnusable;
  }
  if (error.message.toLowerCase().includes("dangerous inbound attachment")) {
    return INBOUND_QUARANTINE_REASONS.dangerousAttachment;
  }
  return INBOUND_QUARANTINE_REASONS.integrityConflict;
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

function isOperationalInfrastructureError(error: unknown): boolean {
  if (error instanceof MailServiceError) {
    return false;
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /network|timeout|temporarily unavailable|ECONN|D1_ERROR/i.test(message);
}

async function findProviderEvent(
  db: Database,
  ingestionEventId: string,
): Promise<MailProviderIngestionEvent | null> {
  const [row] = await db
    .select()
    .from(schema.mailProviderIngestionEvents)
    .where(eq(schema.mailProviderIngestionEvents.id, ingestionEventId))
    .limit(1);
  return row ?? null;
}

async function findInboundChild(
  db: Database,
  ingestionEventId: string,
): Promise<MailInboundIngestionEvent | null> {
  const [row] = await db
    .select()
    .from(schema.mailInboundIngestionEvents)
    .where(eq(schema.mailInboundIngestionEvents.ingestionEventId, ingestionEventId))
    .limit(1);
  return row ?? null;
}

async function findExistingMaterialization(
  db: Database,
  ingestionEventId: string,
): Promise<MailInboundMessageMaterialization | null> {
  const [row] = await db
    .select()
    .from(schema.mailInboundMessageMaterializations)
    .where(
      eq(schema.mailInboundMessageMaterializations.ingestionEventId, ingestionEventId),
    )
    .limit(1);
  return row ?? null;
}

async function loadExistingSemanticGraph(
  db: Database,
  messageId: string,
): Promise<InboundCanonicalSemanticGraph> {
  const [message] = await db
    .select()
    .from(schema.mailMessages)
    .where(eq(schema.mailMessages.id, messageId))
    .limit(1);
  if (!message) {
    throw MailServiceError.notFound("Canonical message not found");
  }
  const [body] = await db
    .select()
    .from(schema.mailMessageBodies)
    .where(eq(schema.mailMessageBodies.messageId, messageId))
    .limit(1);
  const recipients = await db
    .select()
    .from(schema.mailMessageRecipients)
    .where(eq(schema.mailMessageRecipients.messageId, messageId))
    .orderBy(asc(schema.mailMessageRecipients.sortOrder));
  const attachmentRows = await db
    .select()
    .from(schema.mailMessageAttachments)
    .where(eq(schema.mailMessageAttachments.messageId, messageId))
    .orderBy(asc(schema.mailMessageAttachments.sortOrder));

  return {
    direction: "inbound",
    fromAddress: message.fromAddress,
    fromDisplayName: message.fromDisplayName,
    subject: message.subject,
    subjectNormalized: message.subjectNormalized ?? "",
    previewText: message.previewText,
    internetMessageId: message.internetMessageId,
    inReplyTo: message.inReplyTo,
    referencesHeader: message.referencesHeader,
    bodyText: body?.bodyText ?? "",
    bodyHtmlSanitized: body?.bodyHtmlSanitized ?? null,
    recipients: recipients.map((row) => ({
      recipientType: row.recipientType,
      address: row.address,
      displayName: row.displayName,
      sortOrder: row.sortOrder,
    })),
    attachments: attachmentRows.map((row) => ({
      contentHash: row.contentHash,
      sizeBytes: row.sizeBytes,
      mimeType: row.mimeType,
      originalFilename: row.originalFilename,
      displayFilename: row.displayFilename,
      sortOrder: row.sortOrder,
    })),
  };
}

function resolveMaterializedMailboxId(
  inboundChild: MailInboundIngestionEvent,
): string {
  if (inboundChild.resolvedRouteMode === "direct") {
    return inboundChild.routeOwnerMailboxId!;
  }
  if (inboundChild.resolvedRouteMode === "fallback") {
    return inboundChild.resolvedFallbackMailboxId!;
  }
  throw MailServiceError.integrityConflict(
    "Inbound ingestion missing frozen route snapshot for materialization",
  );
}

function resolveMaterializationRouteMode(
  inboundChild: MailInboundIngestionEvent,
): "direct" | "fallback" {
  if (inboundChild.resolvedRouteMode === "direct") {
    return "direct";
  }
  if (inboundChild.resolvedRouteMode === "fallback") {
    return "fallback";
  }
  throw MailServiceError.integrityConflict(
    "Inbound ingestion missing frozen route mode for materialization",
  );
}

async function assertMaterializationTargetOperational(
  db: Database,
  mailboxId: string,
): Promise<void> {
  const [mailbox] = await db
    .select()
    .from(schema.mailMailboxes)
    .where(eq(schema.mailMailboxes.id, mailboxId))
    .limit(1);
  if (!mailbox) {
    throw MailServiceError.integrityConflict(
      "Frozen materialization mailbox no longer exists",
      { mailboxId },
    );
  }
  if (mailbox.status !== "active") {
    throw MailServiceError.integrityConflict(
      "Frozen materialization mailbox is not operational",
      { mailboxId, status: mailbox.status },
    );
  }
}

async function claimInboundProcessing(
  db: Database,
  providerEvent: MailProviderIngestionEvent,
  expectedProcessingVersion?: number,
): Promise<number> {
  if (providerEvent.status === "processing") {
    const version = expectedProcessingVersion ?? providerEvent.processingVersion;
    if (providerEvent.processingVersion !== version) {
      throw MailServiceError.staleVersion(
        "Inbound ingestion processing version mismatch",
      );
    }
    return providerEvent.processingVersion;
  }

  if (providerEvent.status !== "pending") {
    throw MailServiceError.validation(
      "Only pending inbound ingestion events may be materialized",
      { status: providerEvent.status },
    );
  }

  const expectedVersion =
    expectedProcessingVersion ?? providerEvent.processingVersion;
  if (providerEvent.processingVersion !== expectedVersion) {
    throw MailServiceError.staleVersion(
      "Inbound ingestion processing version mismatch",
    );
  }

  const nextVersion = expectedVersion + 1;
  await claimProviderIngestionForProcessing(db, {
    ingestionEventId: providerEvent.id,
    expectedProcessingVersion: expectedVersion,
  });
  return nextVersion;
}

async function quarantineInboundIngestion(
  db: Database,
  input: {
    ingestionEventId: string;
    processingVersion: number;
    quarantineReason: string;
    errorCode?: string;
    errorMessage?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await runGuardedUpdate(
    db,
    buildInboundProviderQuarantineUpdate(db, {
      ingestionEventId: input.ingestionEventId,
      processingProcessingVersion: input.processingVersion,
      nextProcessingVersion: input.processingVersion + 1,
      finalizedAt: now,
      quarantineReason: input.quarantineReason,
      errorCode: input.errorCode ?? MAIL_ERROR_CODES.INTEGRITY_CONFLICT,
      errorMessage: input.errorMessage ?? null,
    }),
    "Inbound ingestion quarantine transition failed",
  );
}

async function loadVerifiedRawPayload(
  store: InboundRawPayloadStore,
  providerEvent: MailProviderIngestionEvent,
): Promise<Uint8Array> {
  if (
    !providerEvent.payloadStorageKey ||
    !providerEvent.payloadContentHash ||
    providerEvent.payloadSizeBytes == null
  ) {
    throw MailServiceError.rawPayloadNotAvailable(
      "Inbound ingestion raw payload reference unavailable",
    );
  }

  const bytes = await store.get(providerEvent.payloadStorageKey);
  if (!bytes) {
    throw MailServiceError.rawPayloadNotAvailable(
      "Inbound raw payload missing from storage",
    );
  }

  const hash = computeInboundPayloadContentHash(bytes);
  if (
    hash !== providerEvent.payloadContentHash ||
    bytes.byteLength !== providerEvent.payloadSizeBytes
  ) {
    throw MailServiceError.integrityConflict("Inbound raw payload integrity conflict", {
      expectedHash: providerEvent.payloadContentHash,
      actualHash: hash,
      expectedSize: providerEvent.payloadSizeBytes,
      actualSize: bytes.byteLength,
    });
  }

  return bytes;
}

async function persistAttachmentSemantics(
  attachmentStore: InboundAttachmentStore,
  parsedAttachments: Awaited<ReturnType<typeof parseInboundMimeBytes>>["attachments"],
) {
  const stored = [];
  for (const attachment of parsedAttachments) {
    const put = await attachmentStore.put({
      bytes: attachment.bytes,
      originalFilename: attachment.originalFilename,
      mimeType: attachment.mimeType,
    });
    if (
      put.contentHash !== computeInboundPayloadContentHash(attachment.bytes) ||
      put.sizeBytes !== attachment.sizeBytes
    ) {
      throw MailServiceError.integrityConflict("Inbound attachment storage integrity conflict");
    }
    stored.push({
      storedFileId: put.storedFileId,
      contentHash: put.contentHash,
      originalFilename: put.originalFilename,
      displayFilename: attachment.displayFilename,
      mimeType: put.mimeType,
      sizeBytes: put.sizeBytes,
      sortOrder: attachment.sortOrder,
      storageProvider: put.storageProvider,
      storageBucket: put.storageBucket,
      storageKey: put.storageKey,
    });
  }
  return stored;
}

async function findExistingInboundByRfcId(
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
    throw MailServiceError.integrityConflict(
      "Ambiguous RFC Message-ID match in mailbox",
      { mailboxId, internetMessageId },
    );
  }
  return rows[0] ?? null;
}

async function finalizeMaterializationBatch(
  db: Database,
  input: {
    guard: InboundMaterializationPostStateGuard;
    processingVersion: number;
    materializationId: string;
    inboundChild: MailInboundIngestionEvent;
    mailMessageId: string;
    materializedMailboxId: string;
    routeMode: "direct" | "fallback";
    fallbackReason: string | null;
    graphStatements: Parameters<typeof runMailBatch>[1];
    recipientCount: number;
    attachmentCount: number;
    internetMessageId: string | null;
    notificationTarget?: ResolvedNotificationTarget | null;
  },
): Promise<MailInboundMessageMaterialization> {
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const statements = [
    ...input.graphStatements,
    buildInboundProviderCompletedCasUpdate(db, input.guard, {
      processingProcessingVersion: input.processingVersion,
      finalizedAt: now,
    }),
    buildInboundMaterializationGuardedInsert(db, input.guard, {
      id: input.materializationId,
      receivingAddressId: input.inboundChild.receivingAddressId!,
      routeOwnerMailboxId: input.inboundChild.routeOwnerMailboxId!,
      routedAddressSnapshot: input.inboundChild.routedAddressSnapshot!,
      envelopeRecipientAddress: input.inboundChild.envelopeRecipientAddress,
      mailMessageId: input.mailMessageId,
      materializedMailboxId: input.materializedMailboxId,
      routeMode: input.routeMode,
      fallbackReason: input.fallbackReason,
      materializedAt: now,
    }),
  ];

  if (input.notificationTarget) {
    statements.push(
      buildResolvedNotificationIntentInsert(db, {
        target: input.notificationTarget,
        notificationType: "new_incoming",
        sourceEntityType: MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailMessage,
        sourceEntityId: input.mailMessageId,
        now,
      }),
    );
  }

  statements.push(
    buildInboundMaterializationGuardedAuditInsert(db, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.inboundMaterialized,
      ingestionEventId: input.guard.ingestionEventId,
      metadata: {
        ingestionEventId: input.guard.ingestionEventId,
        messageId: input.mailMessageId,
        mailboxId: input.materializedMailboxId,
        routeMode: input.routeMode,
        recipientCount: input.recipientCount,
        attachmentCount: input.attachmentCount,
        ...(input.internetMessageId ? { internetMessageId: input.internetMessageId } : {}),
      },
    }),
  );

  const results = await runMailBatch(db, statements);
  const casIndex = input.graphStatements.length;
  assertBatchUpdateChanged(results, casIndex, "Inbound ingestion completion CAS failed");

  const [materialization] = await db
    .select()
    .from(schema.mailInboundMessageMaterializations)
    .where(eq(schema.mailInboundMessageMaterializations.id, input.materializationId))
    .limit(1);
  if (!materialization) {
    throw MailServiceError.conflict("Inbound materialization row missing after batch");
  }
  return materialization;
}

async function buildResultFromMaterialization(
  db: Database,
  materialization: MailInboundMessageMaterialization,
  convergedExistingMessage: boolean,
): Promise<MaterializeInboundIngestionEventResult> {
  const [message] = await db
    .select()
    .from(schema.mailMessages)
    .where(eq(schema.mailMessages.id, materialization.mailMessageId))
    .limit(1);
  if (!message) {
    throw MailServiceError.notFound("Materialized inbound message not found");
  }
  return {
    materialization,
    message,
    threadId: message.threadId,
    mailboxId: message.mailboxId,
    convergedExistingMessage,
  };
}

/**
 * Materializes one durable inbound provider ingestion event into canonical Mail state.
 * Caller supplies only ingestionEventId (+ optional expectedProcessingVersion for CAS).
 */
export async function materializeInboundIngestionEvent(
  db: Database,
  deps: MaterializationDeps,
  input: {
    ingestionEventId: string;
    expectedProcessingVersion?: number;
  },
): Promise<MaterializeInboundIngestionEventResult> {
  const existingMaterialization = await findExistingMaterialization(
    db,
    input.ingestionEventId,
  );
  if (existingMaterialization) {
    return buildResultFromMaterialization(db, existingMaterialization, false);
  }

  const providerEvent = await findProviderEvent(db, input.ingestionEventId);
  if (!providerEvent) {
    throw MailServiceError.notFound("Provider ingestion event not found");
  }
  if (providerEvent.eventKind !== "inbound_message") {
    throw MailServiceError.validation("Not an inbound provider ingestion event");
  }

  const inboundChild = await findInboundChild(db, input.ingestionEventId);
  if (!inboundChild) {
    throw MailServiceError.integrityConflict("Inbound child ingestion row missing");
  }

  let processingVersion: number;
  try {
    processingVersion = await claimInboundProcessing(
      db,
      providerEvent,
      input.expectedProcessingVersion,
    );
  } catch (error) {
    if (!isOperationalInfrastructureError(error)) {
      throw error;
    }
    throw error;
  }

  const materializedMailboxId = resolveMaterializedMailboxId(inboundChild);
  const routeMode = resolveMaterializationRouteMode(inboundChild);
  const fallbackReason =
    routeMode === "fallback"
      ? INBOUND_MATERIALIZATION_FALLBACK_REASONS.routeOwnerNonoperationalAtIngestion
      : null;

  try {
    await assertMaterializationTargetOperational(db, materializedMailboxId);

    const rawBytes = await loadVerifiedRawPayload(
      deps.rawPayloadStore,
      providerEvent,
    );
    const parsed = await parseInboundMimeBytes(rawBytes);
    const dangerousAttachment = findFirstInboundDangerousAttachmentViolation(
      parsed.attachments,
    );
    if (dangerousAttachment) {
      throw MailServiceError.integrityConflict(
        `Dangerous inbound attachment blocked: ${dangerousAttachment.filename}`,
      );
    }
    const storedAttachments = await persistAttachmentSemantics(
      deps.attachmentStore,
      parsed.attachments,
    );
    const candidateGraph = inboundSemanticGraphFromParsedMime(
      parsed,
      storedAttachments.map((row) => ({
        contentHash: row.contentHash,
        sizeBytes: row.sizeBytes,
        mimeType: row.mimeType,
        originalFilename: row.originalFilename,
        displayFilename: row.displayFilename,
        sortOrder: row.sortOrder,
      })),
    );

    let targetMessageId: string;
    let convergedExistingMessage = false;
    let graphStatements: Parameters<typeof runMailBatch>[1] = [];
    let threadId: string;

    if (candidateGraph.internetMessageId) {
      const existingMessage = await findExistingInboundByRfcId(
        db,
        materializedMailboxId,
        candidateGraph.internetMessageId,
      );
      if (existingMessage) {
        const existingGraph = await loadExistingSemanticGraph(db, existingMessage.id);
        assertInboundCanonicalSemanticGraphsEqual(candidateGraph, existingGraph);
        targetMessageId = existingMessage.id;
        threadId = existingMessage.threadId;
        convergedExistingMessage = true;
      } else {
        targetMessageId = crypto.randomUUID();
        const threadResolution = await resolveInboundThread(db, {
          mailboxId: materializedMailboxId,
          inReplyTo: candidateGraph.inReplyTo,
          referencesHeader: candidateGraph.referencesHeader,
        });
        threadId = threadResolution.threadId;
        graphStatements = buildNewInboundGraphStatements(db, {
          threadId,
          messageId: targetMessageId,
          mailboxId: materializedMailboxId,
          receivedAt: providerEvent.receivedAt,
          candidateGraph,
          storedAttachments,
          createThread: threadResolution.createThread,
          replyToMessageId: threadResolution.replyToMessageId,
        });
      }
    } else {
      targetMessageId = crypto.randomUUID();
      const threadResolution = await resolveInboundThread(db, {
        mailboxId: materializedMailboxId,
        inReplyTo: candidateGraph.inReplyTo,
        referencesHeader: candidateGraph.referencesHeader,
      });
      threadId = threadResolution.threadId;
      graphStatements = buildNewInboundGraphStatements(db, {
        threadId,
        messageId: targetMessageId,
        mailboxId: materializedMailboxId,
        receivedAt: providerEvent.receivedAt,
        candidateGraph,
        storedAttachments,
        createThread: threadResolution.createThread,
        replyToMessageId: threadResolution.replyToMessageId,
      });
    }

    const completedProcessingVersion = processingVersion + 1;
    const guard: InboundMaterializationPostStateGuard = {
      ingestionEventId: input.ingestionEventId,
      completedProcessingVersion,
    };

    const notificationTarget = await resolveNewIncomingNotificationTarget(
      db,
      materializedMailboxId,
    );

    try {
      const materialization = await finalizeMaterializationBatch(db, {
        guard,
        processingVersion,
        materializationId: crypto.randomUUID(),
        inboundChild,
        mailMessageId: targetMessageId,
        materializedMailboxId,
        routeMode,
        fallbackReason,
        graphStatements,
        recipientCount: candidateGraph.recipients.length,
        attachmentCount: storedAttachments.length,
        internetMessageId: candidateGraph.internetMessageId,
        notificationTarget,
      });

      const [message] = await db
        .select()
        .from(schema.mailMessages)
        .where(eq(schema.mailMessages.id, targetMessageId))
        .limit(1);
      if (!message) {
        throw MailServiceError.conflict("Materialized inbound message missing after batch");
      }

      return {
        materialization,
        message,
        threadId,
        mailboxId: materializedMailboxId,
        convergedExistingMessage,
      };
    } catch (batchError) {
      if (isUniqueConstraintError(batchError)) {
        const raced = await findExistingMaterialization(db, input.ingestionEventId);
        if (raced) {
          return buildResultFromMaterialization(db, raced, convergedExistingMessage);
        }
      }
      throw batchError;
    }
  } catch (error) {
    if (isOperationalInfrastructureError(error)) {
      throw error;
    }
    if (
      error instanceof MailServiceError &&
      error.errorCode === MAIL_ERROR_CODES.STALE_VERSION
    ) {
      throw error;
    }
    if (
      error instanceof MailServiceError &&
      error.errorCode === MAIL_ERROR_CODES.INTEGRITY_CONFLICT
    ) {
      const reason = resolveQuarantineReason(error);
      await quarantineInboundIngestion(db, {
        ingestionEventId: input.ingestionEventId,
        processingVersion,
        quarantineReason: reason,
        errorMessage: error.message,
      });
    }
    throw error;
  }
}

function buildNewInboundGraphStatements(
  db: Database,
  input: {
    threadId: string;
    messageId: string;
    mailboxId: string;
    receivedAt: string;
    candidateGraph: InboundCanonicalSemanticGraph;
    storedAttachments: Array<{
      storedFileId: string;
      contentHash: string;
      originalFilename: string;
      displayFilename: string;
      mimeType: string;
      sizeBytes: number;
      sortOrder: number;
      storageProvider: "r2";
      storageBucket: string;
      storageKey: string;
    }>;
    createThread: boolean;
    replyToMessageId: string | null;
  },
): Parameters<typeof runMailBatch>[1] {
  const now = new Date().toISOString();
  const statements: Parameters<typeof runMailBatch>[1] = [];

  if (input.createThread) {
    statements.push(
      db.insert(schema.mailThreads).values({
        id: input.threadId,
        mailboxId: input.mailboxId,
        subjectNormalized: input.candidateGraph.subjectNormalized || null,
        lastMessageAt: input.receivedAt,
        createdAt: now,
        updatedAt: now,
      }),
    );
  } else {
    statements.push(
      db
        .update(schema.mailThreads)
        .set({
          lastMessageAt: input.receivedAt,
          updatedAt: now,
        })
        .where(eq(schema.mailThreads.id, input.threadId)),
    );
  }

  statements.push(
    db.insert(schema.mailMessages).values({
      id: input.messageId,
      threadId: input.threadId,
      mailboxId: input.mailboxId,
      direction: "inbound",
      senderIdentityId: null,
      fromAddress: input.candidateGraph.fromAddress,
      fromDisplayName: input.candidateGraph.fromDisplayName,
      subject: input.candidateGraph.subject,
      subjectNormalized: input.candidateGraph.subjectNormalized,
      previewText: input.candidateGraph.previewText,
      sensitivity: "normal",
      internetMessageId: input.candidateGraph.internetMessageId,
      inReplyTo: input.candidateGraph.inReplyTo,
      referencesHeader: input.candidateGraph.referencesHeader,
      replyToMessageId: input.replyToMessageId,
      composeMode: null,
      receivedAt: input.receivedAt,
      sentAt: null,
      trashedAt: null,
      trashedBy: null,
      createdBy: null,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(schema.mailMessageBodies).values({
      messageId: input.messageId,
      bodyText: input.candidateGraph.bodyText,
      bodyHtmlSanitized: input.candidateGraph.bodyHtmlSanitized,
      quotedText: null,
      quotedHtmlSanitized: null,
      sanitizationVersion: INBOUND_BODY_HTML_SANITIZER_POLICY_VERSION,
      createdAt: now,
      updatedAt: now,
    }),
    ...input.candidateGraph.recipients.map((recipient) =>
      db.insert(schema.mailMessageRecipients).values({
        id: crypto.randomUUID(),
        messageId: input.messageId,
        recipientType: recipient.recipientType,
        address: recipient.address,
        displayName: recipient.displayName,
        sortOrder: recipient.sortOrder,
        createdAt: now,
      }),
    ),
    ...input.storedAttachments.map((attachment) =>
      db.insert(schema.mailStoredFiles).values({
        id: attachment.storedFileId,
        contentHash: attachment.contentHash,
        originalFilename: attachment.originalFilename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        storageProvider: attachment.storageProvider,
        storageBucket: attachment.storageBucket,
        storageKey: attachment.storageKey,
        createdByUserId: null,
        securityScanStatus: "unscanned",
        securityScannedAt: null,
        createdAt: now,
      }),
    ),
    ...input.storedAttachments.map((attachment) =>
      db.insert(schema.mailMessageAttachments).values({
        id: crypto.randomUUID(),
        messageId: input.messageId,
        storedFileId: attachment.storedFileId,
        sourceRevisionAttachmentId: null,
        contentHash: attachment.contentHash,
        originalFilename: attachment.originalFilename,
        displayFilename: attachment.displayFilename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        sortOrder: attachment.sortOrder,
        deliveryMode: "direct_attachment",
        secureExpiryDays: null,
        createdAt: now,
      }),
    ),
  );

  return statements;
}
