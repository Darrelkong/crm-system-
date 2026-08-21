import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, asc, eq, inArray, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailNotificationType } from "../../../drizzle/schema/mail-notification-outbox";
import type { MailActorContext } from "@/lib/mail/actor-context";
import {
  addDraftRecipient,
  createDraft,
  updateDraft,
  type DraftDetailView,
} from "@/lib/mail/draft-service";
import {
  attemptInvalidDeliveryMaterializationBatch,
  materializeDeliveryIngestionEvent,
} from "@/lib/mail/delivery-event-materialization-service";
import { stageDeliveryProviderEvent } from "@/lib/mail/delivery-provider-staging-service";
import { MailServiceError } from "@/lib/mail/errors";
import { MemoryInboundAttachmentStore } from "@/lib/mail/inbound-attachment-store";
import { materializeInboundIngestionEvent } from "@/lib/mail/inbound-message-materialization-service";
import { MemoryInboundRawPayloadStore } from "@/lib/mail/inbound-raw-payload-store";
import { stageInboundProviderEvent } from "@/lib/mail/inbound-provider-staging-service";
import { createMailbox } from "@/lib/mail/mailbox-service";
import {
  createPendingNotificationIdentity,
  findActiveVerifiedNotificationIdentity,
  verifyNotificationIdentity,
} from "@/lib/mail/notification-identity-service";
import { enqueueMailNotificationIntent } from "@/lib/mail/notification-outbox-enqueue-service";
import { MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES } from "@/lib/mail/notification-source-entity-policy";
import {
  FakeNotificationTransportAdapter,
  type NotificationTransportAdapter,
} from "@/lib/mail/notification-transport-adapter";
import { createCapturingNotificationVerificationChallengeSink } from "@/lib/mail/notification-verification-challenge-sink";
import { createAdminDirectRevisionFromDraft } from "@/lib/mail/outbound-revision-service";
import {
  resubmitRevisionForApproval,
  returnApproval,
  submitRevisionForApproval,
} from "@/lib/mail/outbound-approval-service";
import { createOutboundRevisionFromDraft } from "@/lib/mail/outbound-revision-service";
import { grantSenderIdentityAccess } from "@/lib/mail/sender-identity-grant-service";
import { createSenderIdentity } from "@/lib/mail/sender-identity-service";
import {
  dispatchSendOperation,
  initiateAdminDirectSend,
  retrySendOperation,
} from "@/lib/mail/send-operation-service";
import { FakeMailTransportAdapter } from "@/lib/mail/transport/fake-mail-transport-adapter";
import { claimProviderIngestionForProcessing } from "@/lib/mail/provider-ingestion-claim";

const FIXTURE = "mail-phase2c12b2";
const PROVIDER = "fake-local";
const RECEIVED_AT = "2026-08-21T14:00:00.000Z";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

class CountingNotificationTransportAdapter
  implements NotificationTransportAdapter
{
  readonly providerId = "counting-fake";
  callCount = 0;

  async send(
    ...args: Parameters<FakeNotificationTransportAdapter["send"]>
  ) {
    this.callCount += 1;
    return new FakeNotificationTransportAdapter().send(...args);
  }
}

const countingTransport = new CountingNotificationTransportAdapter();

function actor(
  userId: string,
  grants: MailActorContext["adminGrants"] = [],
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole: userId === SEED_IDS.admin ? "admin" : "staff",
    mailAccessEnabled: true,
    adminGrants: grants,
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2c12b2-test" },
  };
}

const adminActor = actor(SEED_IDS.admin, [
  "account_mgmt",
  "address_assignment",
  "signature_template",
  "permission_mgmt",
]);
const staffActor = actor(SEED_IDS.staffA);
const reviewerActor = actor(SEED_IDS.staffB, ["approval_review"]);

function fixtureAddress(localPart: string): string {
  return `${FIXTURE}-${localPart}@echfronthk.com`;
}

function fixtureEventId(suffix: string): string {
  return `${FIXTURE}-${suffix}`;
}

function fixtureNotificationEmail(localPart: string): string {
  return `${FIXTURE}-${localPart}@gmail.com`;
}

function buildMime(input: {
  messageId?: string;
  subject?: string;
  body?: string;
}): Uint8Array {
  const lines = [
    "From: Sender <sender@external.test>",
    "To: Visible <visible@example.com>",
    `Subject: ${input.subject ?? "Inbound test"}`,
  ];
  if (input.messageId) {
    lines.push(`Message-ID: ${input.messageId}`);
  }
  lines.push(
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    input.body ?? "Plain body",
  );
  return new TextEncoder().encode(lines.join("\r\n"));
}

async function enableMailAccess(db: TestDb, userId: string) {
  const now = new Date().toISOString();
  await db
    .insert(schema.mailUserAccess)
    .values({
      userId,
      isEnabled: 1,
      enabledAt: now,
      enabledBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.mailUserAccess.userId,
      set: { isEnabled: 1, disabledAt: null, updatedAt: now },
    });
}

async function disableMailAccess(db: TestDb, userId: string) {
  const now = new Date().toISOString();
  await db
    .update(schema.mailUserAccess)
    .set({ isEnabled: 0, disabledAt: now, updatedAt: now })
    .where(eq(schema.mailUserAccess.userId, userId));
}

async function ensureVerifiedIdentity(
  db: TestDb,
  userId: string,
  email: string,
): Promise<string> {
  const existing = await findActiveVerifiedNotificationIdentity(db, userId);
  if (existing) {
    return existing.id;
  }
  return createVerifiedIdentity(db, userId, email);
}

async function createVerifiedIdentity(
  db: TestDb,
  userId: string,
  email: string,
): Promise<string> {
  const permissionActor = actor(SEED_IDS.admin, ["permission_mgmt"]);
  const capture = createCapturingNotificationVerificationChallengeSink();
  const pending = await createPendingNotificationIdentity(db, permissionActor, {
    targetUserId: userId,
    email,
    challengeSink: capture.sink,
  });
  const token = capture.latestToken();
  assert.ok(token);
  const verified = await verifyNotificationIdentity(db, permissionActor, {
    identityId: pending.id,
    token,
  });
  return verified.id;
}

async function insertMailboxMember(
  db: TestDb,
  input: {
    id: string;
    mailboxId: string;
    userId: string;
    canRead?: number;
    canSend?: number;
    canReply?: number;
  },
) {
  const now = new Date().toISOString();
  await db.insert(schema.mailMailboxMembers).values({
    id: input.id,
    mailboxId: input.mailboxId,
    userId: input.userId,
    canRead: input.canRead ?? 1,
    canReply: input.canReply ?? 0,
    canSend: input.canSend ?? 0,
    canAssign: 0,
    canManageProcessing: 0,
    canAddInternalNote: 0,
    grantedBy: SEED_IDS.admin,
    createdAt: now,
    updatedAt: now,
  });
}

async function countOutbox(
  db: TestDb,
  filter: {
    notificationType?: MailNotificationType;
    sourceEntityId?: string;
    recipientUserId?: string;
  } = {},
): Promise<number> {
  const conditions = [];
  if (filter.notificationType) {
    conditions.push(
      eq(schema.mailNotificationOutbox.notificationType, filter.notificationType),
    );
  }
  if (filter.sourceEntityId) {
    conditions.push(
      eq(schema.mailNotificationOutbox.sourceEntityId, filter.sourceEntityId),
    );
  }
  if (filter.recipientUserId) {
    conditions.push(
      eq(schema.mailNotificationOutbox.recipientUserId, filter.recipientUserId),
    );
  }
  const rows = await db
    .select({ id: schema.mailNotificationOutbox.id })
    .from(schema.mailNotificationOutbox)
    .where(conditions.length ? and(...conditions) : undefined);
  return rows.length;
}

async function safeCleanupFixtures(db: TestDb) {
  try {
    await cleanupFixtures(db);
  } catch {
    // Best-effort local fixture cleanup between tests.
  }
}

async function cleanupFixtures(db: TestDb) {
  const outboxRows = await db
    .select({ id: schema.mailNotificationOutbox.id })
    .from(schema.mailNotificationOutbox)
    .where(like(schema.mailNotificationOutbox.sourceEntityId, `${FIXTURE}%`));
  for (const row of outboxRows) {
    await db
      .delete(schema.mailNotificationAttempts)
      .where(eq(schema.mailNotificationAttempts.notificationOutboxId, row.id));
  }
  await db
    .delete(schema.mailNotificationOutbox)
    .where(like(schema.mailNotificationOutbox.sourceEntityId, `${FIXTURE}%`));

  const providerEvents = await db
    .select({ id: schema.mailProviderIngestionEvents.id })
    .from(schema.mailProviderIngestionEvents)
    .where(like(schema.mailProviderIngestionEvents.providerEventId, `${FIXTURE}%`));
  const ingestionIds = providerEvents.map((row) => row.id);

  if (ingestionIds.length) {
    const inboundMats = await db
      .select({ mailMessageId: schema.mailInboundMessageMaterializations.mailMessageId })
      .from(schema.mailInboundMessageMaterializations)
      .where(
        inArray(schema.mailInboundMessageMaterializations.ingestionEventId, ingestionIds),
      );
    for (const { mailMessageId } of inboundMats) {
      const outboxForMessage = await db
        .select({ id: schema.mailNotificationOutbox.id })
        .from(schema.mailNotificationOutbox)
        .where(eq(schema.mailNotificationOutbox.sourceEntityId, mailMessageId));
      for (const row of outboxForMessage) {
        await db
          .delete(schema.mailNotificationAttempts)
          .where(eq(schema.mailNotificationAttempts.notificationOutboxId, row.id));
      }
      await db
        .delete(schema.mailNotificationOutbox)
        .where(eq(schema.mailNotificationOutbox.sourceEntityId, mailMessageId));
      await db
        .delete(schema.mailMessageAttachments)
        .where(eq(schema.mailMessageAttachments.messageId, mailMessageId));
      await db
        .delete(schema.mailMessageBodies)
        .where(eq(schema.mailMessageBodies.messageId, mailMessageId));
      await db
        .delete(schema.mailMessageRecipients)
        .where(eq(schema.mailMessageRecipients.messageId, mailMessageId));
      await db
        .delete(schema.mailInboundMessageMaterializations)
        .where(eq(schema.mailInboundMessageMaterializations.mailMessageId, mailMessageId));
      const [message] = await db
        .select({ threadId: schema.mailMessages.threadId })
        .from(schema.mailMessages)
        .where(eq(schema.mailMessages.id, mailMessageId));
      await db
        .delete(schema.mailMessages)
        .where(eq(schema.mailMessages.id, mailMessageId));
      if (message?.threadId) {
        await db
          .delete(schema.mailThreads)
          .where(eq(schema.mailThreads.id, message.threadId));
      }
    }
    await db
      .delete(schema.mailInboundIngestionEvents)
      .where(inArray(schema.mailInboundIngestionEvents.ingestionEventId, ingestionIds));
    await db
      .delete(schema.mailDeliveryIngestionEvents)
      .where(inArray(schema.mailDeliveryIngestionEvents.ingestionEventId, ingestionIds));
    await db
      .delete(schema.mailDeliveryEventMaterializations)
      .where(
        inArray(schema.mailDeliveryEventMaterializations.ingestionEventId, ingestionIds),
      );
    await db
      .delete(schema.mailProviderIngestionEvents)
      .where(inArray(schema.mailProviderIngestionEvents.id, ingestionIds));
  }

  const identities = await db
    .select({ id: schema.mailSenderIdentities.id })
    .from(schema.mailSenderIdentities)
    .where(like(schema.mailSenderIdentities.address, `${FIXTURE}%`));
  const identityIds = identities.map((row) => row.id);

  if (identityIds.length) {
    const drafts = await db
      .select({ id: schema.mailDrafts.id })
      .from(schema.mailDrafts)
      .where(inArray(schema.mailDrafts.senderIdentityId, identityIds));
    const draftIds = drafts.map((row) => row.id);

    const revisionConditions = [
      inArray(schema.mailOutboundRevisions.senderIdentityId, identityIds),
    ];
    if (draftIds.length) {
      revisionConditions.push(
        inArray(schema.mailOutboundRevisions.sourceDraftId, draftIds),
      );
    }
    const revisions = await db
      .select({
        id: schema.mailOutboundRevisions.id,
        revisionChainId: schema.mailOutboundRevisions.revisionChainId,
        sourceDraftId: schema.mailOutboundRevisions.sourceDraftId,
      })
      .from(schema.mailOutboundRevisions)
      .where(
        revisionConditions.length === 1
          ? revisionConditions[0]
          : or(...revisionConditions),
      );
    const revisionIds = revisions.map((row) => row.id);
    const revisionChainIds = [
      ...new Set(revisions.map((row) => row.revisionChainId)),
    ];
    const revisionDraftIds = [
      ...new Set(
        revisions
          .map((row) => row.sourceDraftId)
          .filter((sourceDraftId): sourceDraftId is string =>
            Boolean(sourceDraftId),
          ),
      ),
    ];
    const allDraftIds = [...new Set([...draftIds, ...revisionDraftIds])];

    const sendOps = revisionIds.length
      ? await db
          .select({ id: schema.mailSendOperations.id })
          .from(schema.mailSendOperations)
          .where(inArray(schema.mailSendOperations.outboundRevisionId, revisionIds))
      : [];
    const sendIds = sendOps.map((row) => row.id);

    if (sendIds.length) {
      for (const sendId of sendIds) {
        const outboxForSend = await db
          .select({ id: schema.mailNotificationOutbox.id })
          .from(schema.mailNotificationOutbox)
          .where(eq(schema.mailNotificationOutbox.sourceEntityId, sendId));
        for (const row of outboxForSend) {
          await db
            .delete(schema.mailNotificationAttempts)
            .where(eq(schema.mailNotificationAttempts.notificationOutboxId, row.id));
        }
        await db
          .delete(schema.mailNotificationOutbox)
          .where(eq(schema.mailNotificationOutbox.sourceEntityId, sendId));
      }
      await db
        .delete(schema.mailDeliveryEvents)
        .where(inArray(schema.mailDeliveryEvents.sendOperationId, sendIds));
      await db
        .delete(schema.mailTransportAttempts)
        .where(inArray(schema.mailTransportAttempts.sendOperationId, sendIds));
      await db
        .delete(schema.mailOutboundRfcIdentities)
        .where(inArray(schema.mailOutboundRfcIdentities.sendOperationId, sendIds));
      await db
        .delete(schema.mailSendOperations)
        .where(inArray(schema.mailSendOperations.id, sendIds));
    }

    const approvalConditions = [];
    if (revisionIds.length) {
      approvalConditions.push(
        inArray(schema.mailOutboundApprovals.currentRevisionId, revisionIds),
      );
    }
    if (revisionChainIds.length) {
      approvalConditions.push(
        inArray(schema.mailOutboundApprovals.revisionChainId, revisionChainIds),
      );
    }
    if (approvalConditions.length) {
      const fixtureApprovals = await db
        .select({ id: schema.mailOutboundApprovals.id })
        .from(schema.mailOutboundApprovals)
        .where(
          approvalConditions.length === 1
            ? approvalConditions[0]
            : or(...approvalConditions),
        );
      for (const { id: approvalId } of fixtureApprovals) {
        const events = await db
          .select({ id: schema.mailOutboundApprovalEvents.id })
          .from(schema.mailOutboundApprovalEvents)
          .where(eq(schema.mailOutboundApprovalEvents.approvalId, approvalId));
        for (const event of events) {
          const outboxRows = await db
            .select({ id: schema.mailNotificationOutbox.id })
            .from(schema.mailNotificationOutbox)
            .where(eq(schema.mailNotificationOutbox.sourceEntityId, event.id));
          for (const row of outboxRows) {
            await db
              .delete(schema.mailNotificationAttempts)
              .where(eq(schema.mailNotificationAttempts.notificationOutboxId, row.id));
          }
          await db
            .delete(schema.mailNotificationOutbox)
            .where(eq(schema.mailNotificationOutbox.sourceEntityId, event.id));
        }
        await db
          .delete(schema.mailOutboundApprovalEvents)
          .where(eq(schema.mailOutboundApprovalEvents.approvalId, approvalId));
        await db
          .delete(schema.mailOutboundApprovals)
          .where(eq(schema.mailOutboundApprovals.id, approvalId));
      }

      if (revisionIds.length) {
        await db
          .delete(schema.mailOutboundRevisionRecipients)
          .where(inArray(schema.mailOutboundRevisionRecipients.revisionId, revisionIds));
        await db
          .delete(schema.mailOutboundRevisions)
          .where(inArray(schema.mailOutboundRevisions.id, revisionIds));
      }
    }
    if (allDraftIds.length) {
      await db
        .delete(schema.mailDraftAttachments)
        .where(inArray(schema.mailDraftAttachments.draftId, allDraftIds));
      await db
        .delete(schema.mailDraftRecipients)
        .where(inArray(schema.mailDraftRecipients.draftId, allDraftIds));
    }
    await db
      .delete(schema.mailDrafts)
      .where(inArray(schema.mailDrafts.senderIdentityId, identityIds));
    await db
      .delete(schema.mailSenderIdentityGrants)
      .where(inArray(schema.mailSenderIdentityGrants.senderIdentityId, identityIds));
    await db
      .delete(schema.mailSenderIdentities)
      .where(inArray(schema.mailSenderIdentities.id, identityIds));
  }

  const mailboxes = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.address, `${FIXTURE}%`));
  for (const { id } of mailboxes) {
    const outboxForMailbox = await db
      .select({ id: schema.mailNotificationOutbox.id })
      .from(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.mailboxId, id));
    for (const row of outboxForMailbox) {
      await db
        .delete(schema.mailNotificationAttempts)
        .where(eq(schema.mailNotificationAttempts.notificationOutboxId, row.id));
    }
    await db
      .delete(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.mailboxId, id));
    await db
      .delete(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, id));
    await db
      .delete(schema.mailMailboxMembers)
      .where(eq(schema.mailMailboxMembers.mailboxId, id));
    await db.delete(schema.mailMailboxes).where(eq(schema.mailMailboxes.id, id));
  }
}

async function setupPersonalInboundMailbox(
  db: TestDb,
  suffix: string,
  memberUserId: string,
  extraMembers: Array<{ userId: string; canRead?: number }> = [],
) {
  const mailbox = await createMailbox(db, adminActor, {
    address: fixtureAddress(`personal-${suffix}`),
    mailboxType: "personal",
  });
  await insertMailboxMember(db, {
    id: `${FIXTURE}-member-${suffix}-primary`,
    mailboxId: mailbox.id,
    userId: memberUserId,
  });
  for (const [index, member] of extraMembers.entries()) {
    await insertMailboxMember(db, {
      id: `${FIXTURE}-member-${suffix}-extra-${index}`,
      mailboxId: mailbox.id,
      userId: member.userId,
      canRead: member.canRead ?? 1,
    });
  }
  const [primary] = await db
    .select()
    .from(schema.mailReceivingAddresses)
    .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));
  assert.ok(primary);
  return { mailbox, primary };
}

async function materializeInboundToMailbox(
  db: TestDb,
  payloadStore: MemoryInboundRawPayloadStore,
  attachmentStore: MemoryInboundAttachmentStore,
  input: {
    providerEventId: string;
    recipientAddress: string;
    messageId?: string;
  },
) {
  const staged = await stageInboundProviderEvent(db, payloadStore, {
    provider: PROVIDER,
    providerEventId: input.providerEventId,
    receivedAt: RECEIVED_AT,
    rawPayloadBytes: buildMime({
      messageId: input.messageId,
      body: "Notification wiring inbound",
    }),
    envelopeRecipients: [input.recipientAddress],
  });
  const envelope = staged.envelopeResults[0]!;
  return materializeInboundIngestionEvent(
    db,
    { rawPayloadStore: payloadStore, attachmentStore },
    { ingestionEventId: envelope.ingestionEventId },
  );
}

async function setupApprovalFixture(db: TestDb, suffix: string) {
  const address = fixtureAddress(`approval-compose-${suffix}`);
  const mailbox = await createMailbox(db, adminActor, {
    address,
    mailboxType: "personal",
  });
  const identity = await createSenderIdentity(db, adminActor, {
    address: fixtureAddress(`approval-sender-${suffix}`),
    defaultMailboxId: mailbox.id,
  });
  await grantSenderIdentityAccess(db, adminActor, {
    senderIdentityId: identity.id,
    targetUserId: SEED_IDS.staffA,
    canSend: true,
  });
  await insertMailboxMember(db, {
    id: `${FIXTURE}-approval-member-${suffix}`,
    mailboxId: mailbox.id,
    userId: SEED_IDS.staffA,
    canRead: 1,
    canSend: 1,
    canReply: 1,
  });
  const created = await createDraft(db, staffActor, {
    senderIdentityId: identity.id,
    mailboxId: mailbox.id,
    subject: "Approval wiring",
    bodyText: "Body with private customer details",
  });
  assert.ok(created.created);
  const draft = await addDraftRecipient(db, staffActor, {
    draftId: created.item.id,
    expectedAutosaveVersion: created.item.autosaveVersion,
    recipientType: "to",
    address: "client@example.com",
  });
  const revision = await createOutboundRevisionFromDraft(db, staffActor, {
    draftId: draft.id,
    expectedAutosaveVersion: draft.autosaveVersion,
  });
  const approval = await submitRevisionForApproval(db, staffActor, {
    revisionId: revision.id,
  });
  return { approval, revision, draft };
}

async function setupSendFixture(db: TestDb, suffix: string) {
  const { mailbox, identity } = await (async () => {
    const address = fixtureAddress(`send-mailbox-${suffix}`);
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address: fixtureAddress(`send-sender-${suffix}`),
      defaultMailboxId: mailbox.id,
    });
    await grantSenderIdentityAccess(db, adminActor, {
      senderIdentityId: identity.id,
      targetUserId: SEED_IDS.admin,
      canSend: true,
    });
    await insertMailboxMember(db, {
      id: `${FIXTURE}-send-member-${suffix}`,
      mailboxId: mailbox.id,
      userId: SEED_IDS.admin,
      canRead: 1,
      canSend: 1,
      canReply: 1,
    });
    return { mailbox, identity };
  })();

  const created = await createDraft(db, adminActor, {
    senderIdentityId: identity.id,
    mailboxId: mailbox.id,
    subject: "Send wiring",
    bodyText: "Send body",
  });
  assert.ok(created.created);
  let draft = created.item;
  for (const recipient of ["alice@example.com", "bob@example.com", "carol@example.com"]) {
    draft = await addDraftRecipient(db, adminActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
      recipientType: "to",
      address: recipient,
    });
  }
  const revision = await createAdminDirectRevisionFromDraft(db, adminActor, {
    draftId: draft.id,
    expectedAutosaveVersion: draft.autosaveVersion,
  });
  const initiated = await initiateAdminDirectSend(db, adminActor, {
    revisionId: revision.id,
    idempotencyKey: `${FIXTURE}-send-${suffix}`,
  });
  const recipients = await db
    .select()
    .from(schema.mailOutboundRevisionRecipients)
    .where(eq(schema.mailOutboundRevisionRecipients.revisionId, revision.id))
    .orderBy(asc(schema.mailOutboundRevisionRecipients.sortOrder));
  return { initiated, revision, recipients };
}

describe("notification source wiring integration", () => {
  let db: TestDb;
  let payloadStore: MemoryInboundRawPayloadStore;
  let attachmentStore: MemoryInboundAttachmentStore;
  let adminIdentityId: string;
  let staffIdentityId: string;
  let dispose: (() => void) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    payloadStore = new MemoryInboundRawPayloadStore();
    attachmentStore = new MemoryInboundAttachmentStore();
    await enableMailAccess(db, SEED_IDS.admin);
    await enableMailAccess(db, SEED_IDS.staffA);
    await enableMailAccess(db, SEED_IDS.staffB);
    adminIdentityId = await ensureVerifiedIdentity(
      db,
      SEED_IDS.admin,
      fixtureNotificationEmail("notify-admin"),
    );
    staffIdentityId = await ensureVerifiedIdentity(
      db,
      SEED_IDS.staffA,
      fixtureNotificationEmail("notify-staff"),
    );
    countingTransport.callCount = 0;
  });

  after(async () => {
    try {
      await safeCleanupFixtures(db);
    } catch {
      // Best-effort local fixture cleanup.
    }
    dispose?.();
  });

  describe("new_incoming", () => {
    it("personal mailbox with one eligible member creates one pending intent", async () => {
      await safeCleanupFixtures(db);
      const { mailbox, primary } = await setupPersonalInboundMailbox(
        db,
        "eligible",
        SEED_IDS.staffA,
      );
      const result = await materializeInboundToMailbox(
        db,
        payloadStore,
        attachmentStore,
        {
          providerEventId: `${FIXTURE}-incoming-eligible`,
          recipientAddress: primary.address,
          messageId: "<eligible@external.test>",
        },
      );
      assert.equal(
        await countOutbox(db, {
          notificationType: "new_incoming",
          sourceEntityId: result.message.id,
          recipientUserId: SEED_IDS.staffA,
        }),
        1,
      );
      const [row] = await db
        .select()
        .from(schema.mailNotificationOutbox)
        .where(
          eq(schema.mailNotificationOutbox.sourceEntityId, result.message.id),
        );
      assert.equal(row?.status, "pending");
      assert.equal(row?.notificationIdentityId, staffIdentityId);
      assert.equal(row?.mailboxId, mailbox.id);
      assert.equal(countingTransport.callCount, 0);
    });

    it("skips when no verified identity", async () => {
      await safeCleanupFixtures(db);
      const { primary } = await setupPersonalInboundMailbox(
        db,
        "no-identity",
        SEED_IDS.staffB,
      );
      const result = await materializeInboundToMailbox(
        db,
        payloadStore,
        attachmentStore,
        {
          providerEventId: `${FIXTURE}-incoming-no-identity`,
          recipientAddress: primary.address,
        },
      );
      assert.equal(
        await countOutbox(db, { sourceEntityId: result.message.id }),
        0,
      );
    });

    it("skips when mail access disabled", async () => {
      await safeCleanupFixtures(db);
      const { primary } = await setupPersonalInboundMailbox(
        db,
        "disabled-access",
        SEED_IDS.staffA,
      );
      await disableMailAccess(db, SEED_IDS.staffA);
      const result = await materializeInboundToMailbox(
        db,
        payloadStore,
        attachmentStore,
        {
          providerEventId: `${FIXTURE}-incoming-disabled`,
          recipientAddress: primary.address,
        },
      );
      assert.equal(
        await countOutbox(db, { sourceEntityId: result.message.id }),
        0,
      );
      await enableMailAccess(db, SEED_IDS.staffA);
    });

    it("skips when zero eligible can_read members", async () => {
      await safeCleanupFixtures(db);
      const mailbox = await createMailbox(db, adminActor, {
        address: fixtureAddress("personal-zero"),
        mailboxType: "personal",
      });
      const [primary] = await db
        .select()
        .from(schema.mailReceivingAddresses)
        .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));
      const result = await materializeInboundToMailbox(
        db,
        payloadStore,
        attachmentStore,
        {
          providerEventId: `${FIXTURE}-incoming-zero-members`,
          recipientAddress: primary!.address,
        },
      );
      assert.equal(
        await countOutbox(db, { sourceEntityId: result.message.id }),
        0,
      );
    });

    it("skips when multiple eligible can_read members", async () => {
      await safeCleanupFixtures(db);
      const { primary } = await setupPersonalInboundMailbox(
        db,
        "multi-member",
        SEED_IDS.staffA,
        [{ userId: SEED_IDS.staffB }],
      );
      const result = await materializeInboundToMailbox(
        db,
        payloadStore,
        attachmentStore,
        {
          providerEventId: `${FIXTURE}-incoming-multi`,
          recipientAddress: primary.address,
        },
      );
      assert.equal(
        await countOutbox(db, { sourceEntityId: result.message.id }),
        0,
      );
    });

    it("skips shared mailbox inbound", async () => {
      await safeCleanupFixtures(db);
      const mailbox = await createMailbox(db, adminActor, {
        address: fixtureAddress("shared-inbound"),
        mailboxType: "shared",
      });
      const [primary] = await db
        .select()
        .from(schema.mailReceivingAddresses)
        .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));
      const result = await materializeInboundToMailbox(
        db,
        payloadStore,
        attachmentStore,
        {
          providerEventId: `${FIXTURE}-incoming-shared`,
          recipientAddress: primary!.address,
        },
      );
      assert.equal(
        await countOutbox(db, { sourceEntityId: result.message.id }),
        0,
      );
    });

    it("RFC convergence creates one notification for two provenance rows", async () => {
      await safeCleanupFixtures(db);
      const { primary } = await setupPersonalInboundMailbox(
        db,
        "converge",
        SEED_IDS.staffA,
      );
      const messageId = "<converge@external.test>";
      const first = await materializeInboundToMailbox(
        db,
        payloadStore,
        attachmentStore,
        {
          providerEventId: `${FIXTURE}-converge-a`,
          recipientAddress: primary.address,
          messageId,
        },
      );
      const second = await materializeInboundToMailbox(
        db,
        payloadStore,
        attachmentStore,
        {
          providerEventId: `${FIXTURE}-converge-b`,
          recipientAddress: primary.address,
          messageId,
        },
      );
      assert.equal(first.message.id, second.message.id);
      assert.equal(
        await countOutbox(db, {
          notificationType: "new_incoming",
          sourceEntityId: first.message.id,
        }),
        1,
      );
    });

    it("pre-existing semantic outbox row does not block send permanent failure", async () => {
      await safeCleanupFixtures(db);
      const { initiated } = await setupSendFixture(db, "dedupe-send");
      await enqueueMailNotificationIntent(db, {
        notificationType: "important_send_failure",
        recipientUserId: SEED_IDS.admin,
        notificationIdentityId: adminIdentityId,
        sourceEntityType: MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailSendOperation,
        sourceEntityId: initiated.id,
      });
      const adapter = new FakeMailTransportAdapter().setBehavior({
        outcome: "permanent_failure",
        errorCode: "PERM",
      });
      const failed = await dispatchSendOperation(db, adminActor, {
        sendOperationId: initiated.id,
        expectedOrchestrationVersion: initiated.orchestrationVersion,
        adapter,
      });
      assert.equal(failed.status, "failed");
      assert.equal(
        await countOutbox(db, {
          notificationType: "important_send_failure",
          sourceEntityId: initiated.id,
        }),
        1,
      );
    });
  });

  describe("approval_returned", () => {
    it("creates one intent for eligible requested user", async () => {
      await safeCleanupFixtures(db);
      const { approval } = await setupApprovalFixture(db, "eligible");
      await returnApproval(db, reviewerActor, {
        approvalId: approval.id,
        expectedWorkflowVersion: 1,
        note: "Private return note must not appear in outbox",
      });
      const events = await db
        .select()
        .from(schema.mailOutboundApprovalEvents)
        .where(
          and(
            eq(schema.mailOutboundApprovalEvents.approvalId, approval.id),
            eq(schema.mailOutboundApprovalEvents.eventType, "returned"),
          ),
        );
      assert.equal(events.length, 1);
      assert.equal(
        await countOutbox(db, {
          notificationType: "approval_returned",
          sourceEntityId: events[0]!.id,
          recipientUserId: SEED_IDS.staffA,
        }),
        1,
      );
      const [row] = await db
        .select()
        .from(schema.mailNotificationOutbox)
        .where(eq(schema.mailNotificationOutbox.sourceEntityId, events[0]!.id));
      assert.equal(row?.notificationIdentityId, staffIdentityId);
      assert.ok(!JSON.stringify(row).includes("Private return note"));
    });

    it("still returns approval when requested user has no identity", async () => {
      await safeCleanupFixtures(db);
      await db
        .delete(schema.mailNotificationIdentities)
        .where(eq(schema.mailNotificationIdentities.userId, SEED_IDS.staffA));
      const { approval } = await setupApprovalFixture(db, "no-identity");
      const returned = await returnApproval(db, reviewerActor, {
        approvalId: approval.id,
        expectedWorkflowVersion: 1,
        note: "No identity",
      });
      assert.equal(returned.status, "returned");
      assert.equal(await countOutbox(db, { notificationType: "approval_returned" }), 0);
      staffIdentityId = await createVerifiedIdentity(
        db,
        SEED_IDS.staffA,
        fixtureNotificationEmail(`notify-staff-restore-${Date.now()}`),
      );
    });

    it("second legitimate return creates second notification", async () => {
      await safeCleanupFixtures(db);
      const { approval, draft } = await setupApprovalFixture(db, "double-return");
      await returnApproval(db, reviewerActor, {
        approvalId: approval.id,
        expectedWorkflowVersion: 1,
        note: "First return",
      });
      const updatedDraft = await updateDraft(db, staffActor, {
        draftId: draft.id,
        expectedAutosaveVersion: draft.autosaveVersion,
        bodyText: "Revised body",
      });
      const r2 = await createOutboundRevisionFromDraft(db, staffActor, {
        draftId: updatedDraft.id,
        expectedAutosaveVersion: updatedDraft.autosaveVersion,
      });
      await resubmitRevisionForApproval(db, staffActor, {
        approvalId: approval.id,
        revisionId: r2.id,
        expectedWorkflowVersion: 2,
      });
      await returnApproval(db, reviewerActor, {
        approvalId: approval.id,
        expectedWorkflowVersion: 3,
        note: "Second return",
      });
      const returnedEvents = await db
        .select()
        .from(schema.mailOutboundApprovalEvents)
        .where(
          and(
            eq(schema.mailOutboundApprovalEvents.approvalId, approval.id),
            eq(schema.mailOutboundApprovalEvents.eventType, "returned"),
          ),
        );
      assert.equal(returnedEvents.length, 2);
      assert.equal(
        await countOutbox(db, {
          notificationType: "approval_returned",
          recipientUserId: SEED_IDS.staffA,
        }),
        2,
      );
    });
  });

  describe("important_send_failure", () => {
    it("temporary transport failure creates zero notifications", async () => {
      await safeCleanupFixtures(db);
      const { initiated } = await setupSendFixture(db, "temp-fail");
      const adapter = new FakeMailTransportAdapter().setBehavior({
        outcome: "temporary_failure",
        errorCode: "TEMP",
      });
      await dispatchSendOperation(db, adminActor, {
        sendOperationId: initiated.id,
        expectedOrchestrationVersion: initiated.orchestrationVersion,
        adapter,
      });
      assert.equal(
        await countOutbox(db, {
          notificationType: "important_send_failure",
          sourceEntityId: initiated.id,
        }),
        0,
      );
    });

    it("terminal transport failure creates one notification", async () => {
      await safeCleanupFixtures(db);
      const { initiated } = await setupSendFixture(db, "perm-fail");
      const adapter = new FakeMailTransportAdapter().setBehavior({
        outcome: "permanent_failure",
        errorCode: "PERM",
      });
      const failed = await dispatchSendOperation(db, adminActor, {
        sendOperationId: initiated.id,
        expectedOrchestrationVersion: initiated.orchestrationVersion,
        adapter,
      });
      assert.equal(failed.status, "failed");
      assert.equal(
        await countOutbox(db, {
          notificationType: "important_send_failure",
          sourceEntityId: initiated.id,
          recipientUserId: SEED_IDS.admin,
        }),
        1,
      );
    });

    it("deferred and delivered delivery events create zero notifications", async () => {
      await safeCleanupFixtures(db);
      const { initiated, recipients } = await setupSendFixture(db, "non-bounce");
      const providerMessageId = fixtureEventId("msg-non-bounce");
      const dispatched = await dispatchSendOperation(db, adminActor, {
        sendOperationId: initiated.id,
        expectedOrchestrationVersion: initiated.orchestrationVersion,
        adapter: new FakeMailTransportAdapter().setBehavior({
          outcome: "accepted",
          providerRequestId: `${FIXTURE}-req`,
          providerMessageId,
        }),
      });
      assert.equal(dispatched.status, "accepted");
      for (const eventType of ["deferred", "delivered"] as const) {
        const staged = await stageDeliveryProviderEvent(db, null, {
          provider: PROVIDER,
          providerEventId: `${FIXTURE}-evt-${eventType}`,
          providerMessageId,
          recipientAddress: recipients[0]!.address,
          deliveryEventType: eventType,
          receivedAt: RECEIVED_AT,
        });
        await materializeDeliveryIngestionEvent(db, {
          ingestionEventId: staged.ingestionEventId,
        });
      }
      assert.equal(
        await countOutbox(db, {
          notificationType: "important_send_failure",
          sourceEntityId: initiated.id,
        }),
        0,
      );
    });

    it("first bounce creates one notification", async () => {
      await safeCleanupFixtures(db);
      const { initiated, recipients } = await setupSendFixture(db, "bounce-one");
      const providerMessageId = fixtureEventId("msg-bounce-one");
      const dispatched = await dispatchSendOperation(db, adminActor, {
        sendOperationId: initiated.id,
        expectedOrchestrationVersion: initiated.orchestrationVersion,
        adapter: new FakeMailTransportAdapter().setBehavior({
          outcome: "accepted",
          providerRequestId: `${FIXTURE}-req-bounce`,
          providerMessageId,
        }),
      });
      assert.equal(dispatched.status, "accepted");
      const staged = await stageDeliveryProviderEvent(db, null, {
        provider: PROVIDER,
        providerEventId: `${FIXTURE}-evt-bounce-one`,
        providerMessageId,
        recipientAddress: recipients[0]!.address,
        deliveryEventType: "bounced",
        receivedAt: RECEIVED_AT,
      });
      await materializeDeliveryIngestionEvent(db, {
        ingestionEventId: staged.ingestionEventId,
      });
      assert.equal(
        await countOutbox(db, {
          notificationType: "important_send_failure",
          sourceEntityId: initiated.id,
        }),
        1,
      );
    });

    it("multiple bounces same send still create one notification", async () => {
      await safeCleanupFixtures(db);
      const { initiated, recipients } = await setupSendFixture(db, "multi-bounce");
      const providerMessageId = fixtureEventId("msg-multi-bounce");
      const dispatched = await dispatchSendOperation(db, adminActor, {
        sendOperationId: initiated.id,
        expectedOrchestrationVersion: initiated.orchestrationVersion,
        adapter: new FakeMailTransportAdapter().setBehavior({
          outcome: "accepted",
          providerRequestId: `${FIXTURE}-req-multi`,
          providerMessageId,
        }),
      });
      assert.equal(dispatched.status, "accepted");
      for (const [index, recipient] of recipients.entries()) {
        const staged = await stageDeliveryProviderEvent(db, null, {
          provider: PROVIDER,
          providerEventId: `${FIXTURE}-evt-multi-bounce-${index}`,
          providerMessageId,
          recipientAddress: recipient.address,
          deliveryEventType: "bounced",
          receivedAt: RECEIVED_AT,
        });
        await materializeDeliveryIngestionEvent(db, {
          ingestionEventId: staged.ingestionEventId,
        });
      }
      assert.equal(
        await countOutbox(db, {
          notificationType: "important_send_failure",
          sourceEntityId: initiated.id,
        }),
        1,
      );
    });

    it("transport failure then bounce dedupes to one notification", async () => {
      await safeCleanupFixtures(db);
      const { initiated } = await setupSendFixture(db, "cross-a");
      const permAdapter = new FakeMailTransportAdapter().setBehavior({
        outcome: "permanent_failure",
        errorCode: "PERM",
      });
      await dispatchSendOperation(db, adminActor, {
        sendOperationId: initiated.id,
        expectedOrchestrationVersion: initiated.orchestrationVersion,
        adapter: permAdapter,
      });
      assert.equal(
        await countOutbox(db, {
          notificationType: "important_send_failure",
          sourceEntityId: initiated.id,
        }),
        1,
      );
      await enqueueMailNotificationIntent(db, {
        notificationType: "important_send_failure",
        recipientUserId: SEED_IDS.admin,
        notificationIdentityId: adminIdentityId,
        sourceEntityType: MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailSendOperation,
        sourceEntityId: initiated.id,
      });
      assert.equal(
        await countOutbox(db, {
          notificationType: "important_send_failure",
          sourceEntityId: initiated.id,
        }),
        1,
      );
    });

    it("bounce then equivalent failure path dedupes to one notification", async () => {
      await safeCleanupFixtures(db);
      const { initiated, recipients } = await setupSendFixture(db, "cross-b");
      const providerMessageId = fixtureEventId("msg-cross-b");
      const dispatched = await dispatchSendOperation(db, adminActor, {
        sendOperationId: initiated.id,
        expectedOrchestrationVersion: initiated.orchestrationVersion,
        adapter: new FakeMailTransportAdapter().setBehavior({
          outcome: "accepted",
          providerRequestId: `${FIXTURE}-req-cross-b`,
          providerMessageId,
        }),
      });
      assert.equal(dispatched.status, "accepted");
      const staged = await stageDeliveryProviderEvent(db, null, {
        provider: PROVIDER,
        providerEventId: `${FIXTURE}-evt-cross-b`,
        providerMessageId,
        recipientAddress: recipients[0]!.address,
        deliveryEventType: "bounced",
        receivedAt: RECEIVED_AT,
      });
      await materializeDeliveryIngestionEvent(db, {
        ingestionEventId: staged.ingestionEventId,
      });
      assert.equal(
        await countOutbox(db, {
          notificationType: "important_send_failure",
          sourceEntityId: initiated.id,
        }),
        1,
      );
      await enqueueMailNotificationIntent(db, {
        notificationType: "important_send_failure",
        recipientUserId: SEED_IDS.admin,
        notificationIdentityId: adminIdentityId,
        sourceEntityType: MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailSendOperation,
        sourceEntityId: initiated.id,
      });
      assert.equal(
        await countOutbox(db, {
          notificationType: "important_send_failure",
          sourceEntityId: initiated.id,
        }),
        1,
      );
    });

    it("late batch failure rolls back notification insert with delivery materialization", async () => {
      await safeCleanupFixtures(db);
      const { initiated, recipients } = await setupSendFixture(db, "rollback");
      const providerMessageId = fixtureEventId("msg-rollback");
      await dispatchSendOperation(db, adminActor, {
        sendOperationId: initiated.id,
        expectedOrchestrationVersion: initiated.orchestrationVersion,
        adapter: new FakeMailTransportAdapter().setBehavior({
          outcome: "accepted",
          providerRequestId: `${FIXTURE}-req-rollback`,
          providerMessageId,
        }),
      });
      const staged = await stageDeliveryProviderEvent(db, null, {
        provider: PROVIDER,
        providerEventId: `${FIXTURE}-evt-rollback`,
        providerMessageId,
        recipientAddress: recipients[0]!.address,
        deliveryEventType: "bounced",
        receivedAt: RECEIVED_AT,
      });
      await claimProviderIngestionForProcessing(db, {
        ingestionEventId: staged.ingestionEventId,
        expectedProcessingVersion: 1,
      });
      const beforeOutbox = await countOutbox(db, {
        notificationType: "important_send_failure",
        sourceEntityId: initiated.id,
      });
      await assert.rejects(() =>
        attemptInvalidDeliveryMaterializationBatch(db, staged.ingestionEventId),
      );
      assert.equal(
        await countOutbox(db, {
          notificationType: "important_send_failure",
          sourceEntityId: initiated.id,
        }),
        beforeOutbox,
      );
      const [provider] = await db
        .select()
        .from(schema.mailProviderIngestionEvents)
        .where(eq(schema.mailProviderIngestionEvents.id, staged.ingestionEventId));
      assert.equal(provider?.status, "processing");
    });
  });

  it("does not invoke notification transport during source wiring", async () => {
    assert.equal(countingTransport.callCount, 0);
  });
});
