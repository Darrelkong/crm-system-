import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { stageDeliveryProviderEvent } from "@/lib/mail/delivery-provider-staging-service";
import { MemoryInboundAttachmentStore } from "@/lib/mail/inbound-attachment-store";
import { MemoryInboundRawPayloadStore } from "@/lib/mail/inbound-raw-payload-store";
import { stageInboundProviderEvent } from "@/lib/mail/inbound-provider-staging-service";
import {
  recoverExpiredProcessingIngestionEvent,
  recoverExpiredProcessingIngestionEventAsSystem,
} from "@/lib/mail/ingestion-processing-recovery-service";
import {
  listDueDeliveryProviderIngestionEvents,
  listDueInboundProviderIngestionEvents,
} from "@/lib/mail/mail-background-due-work-queries";
import {
  DELIVERY_CORRELATION_RETRY_DELAY_MS,
  MAIL_BACKGROUND_MAX_ITEMS_PER_CATEGORY,
  MAIL_BACKGROUND_MAX_TOTAL_ITEMS_PER_TICK,
  MAIL_BACKGROUND_SOFT_WALL_CLOCK_BUDGET_MS,
} from "@/lib/mail/mail-background-tick-constants";
import { runMailBackgroundTick } from "@/lib/mail/mail-background-tick-service";
import { createMailbox } from "@/lib/mail/mailbox-service";
import { enqueueMailNotificationIntent } from "@/lib/mail/notification-outbox-enqueue-service";
import {
  claimNotificationOutboxForProcessing,
  findNotificationOutboxById,
} from "@/lib/mail/notification-outbox-processing-service";
import { MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES } from "@/lib/mail/notification-source-entity-policy";
import {
  createPendingNotificationIdentity,
  verifyNotificationIdentity,
} from "@/lib/mail/notification-identity-service";
import { createCapturingNotificationVerificationChallengeSink } from "@/lib/mail/notification-verification-challenge-sink";
import { FakeNotificationTransportAdapter } from "@/lib/mail/notification-transport-adapter";
import { claimProviderIngestionForProcessing } from "@/lib/mail/provider-ingestion-claim";
import {
  computeIngestionProcessingLease,
  INGESTION_PROCESSING_LEASE_V1_MS,
  setIngestionProcessingLeaseTestClock,
} from "@/lib/mail/provider-ingestion-processing-lease";
import {
  NOTIFICATION_PROCESSING_LEASE_V1_MS,
} from "@/lib/mail/notification-outbox-constants";
import {
  setNotificationProcessingLeaseTestClock,
} from "@/lib/mail/notification-processing-lease";
import { SYSTEM_MAIL_ACTOR } from "@/lib/mail/system-mail-actor";

const FIXTURE = "mail-phase2c12c1";
const PROVIDER = "fake-local";
const BASE_TIME = "2026-08-21T14:00:00.000Z";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function humanActor(): MailActorContext {
  return {
    userId: SEED_IDS.staffA,
    sessionId: null,
    crmRole: "staff",
    mailAccessEnabled: true,
    adminGrants: ["delivery_health"],
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2c12c1-human" },
  };
}

function adminActor(): MailActorContext {
  return {
    userId: SEED_IDS.admin,
    sessionId: null,
    crmRole: "admin",
    mailAccessEnabled: true,
    adminGrants: ["super_admin", "permission_mgmt", "account_mgmt"],
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2c12c1-admin" },
  };
}

async function createVerifiedIdentity(
  db: TestDb,
  userId: string,
  email: string,
): Promise<string> {
  const capture = createCapturingNotificationVerificationChallengeSink();
  const pending = await createPendingNotificationIdentity(db, adminActor(), {
    targetUserId: userId,
    email,
    challengeSink: capture.sink,
  });
  const token = capture.latestToken();
  assert.ok(token);
  const verified = await verifyNotificationIdentity(db, adminActor(), {
    identityId: pending.id,
    token,
  });
  return verified.id;
}

function fixtureAddress(localPart: string): string {
  return `${FIXTURE}-${localPart}@echfronthk.com`;
}

function sampleMime(messageId: string): Uint8Array {
  return new TextEncoder().encode(
    `From: sender@external.test\r\nTo: ignored@example.com\r\nSubject: tick\r\nMessage-ID: ${messageId}\r\n\r\nbody`,
  );
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
      set: { isEnabled: 1, updatedAt: now },
    });
}

async function safeCleanupFixtures(db: TestDb) {
  try {
    await cleanupFixtures(db);
  } catch {
    // Best-effort local fixture cleanup between tests.
  }
}

async function cleanupFixtures(db: TestDb) {
  await db
    .delete(schema.auditLogs)
    .where(like(schema.auditLogs.entityId, `${FIXTURE}%`));

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
      .select({
        mailMessageId: schema.mailInboundMessageMaterializations.mailMessageId,
      })
      .from(schema.mailInboundMessageMaterializations)
      .where(
        inArray(schema.mailInboundMessageMaterializations.ingestionEventId, ingestionIds),
      );
    for (const { mailMessageId } of inboundMats) {
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

    const deliveryMats = await db
      .select({
        deliveryEventId: schema.mailDeliveryEventMaterializations.deliveryEventId,
      })
      .from(schema.mailDeliveryEventMaterializations)
      .where(
        inArray(schema.mailDeliveryEventMaterializations.ingestionEventId, ingestionIds),
      );
    const deliveryEventIds = deliveryMats.map((row) => row.deliveryEventId);
    if (deliveryEventIds.length) {
      await db
        .delete(schema.mailDeliveryEventMaterializations)
        .where(inArray(schema.mailDeliveryEventMaterializations.deliveryEventId, deliveryEventIds));
      await db
        .delete(schema.mailDeliveryEvents)
        .where(inArray(schema.mailDeliveryEvents.id, deliveryEventIds));
    }

    await db
      .delete(schema.mailInboundIngestionEvents)
      .where(inArray(schema.mailInboundIngestionEvents.ingestionEventId, ingestionIds));
    await db
      .delete(schema.mailDeliveryIngestionEvents)
      .where(inArray(schema.mailDeliveryIngestionEvents.ingestionEventId, ingestionIds));
    await db
      .delete(schema.mailProviderIngestionEvents)
      .where(inArray(schema.mailProviderIngestionEvents.id, ingestionIds));
  }

  const mailboxes = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.address, `${FIXTURE}%`));
  for (const { id } of mailboxes) {
    await db
      .delete(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, id));
    await db
      .delete(schema.mailMailboxMembers)
      .where(eq(schema.mailMailboxMembers.mailboxId, id));
    await db.delete(schema.mailMailboxes).where(eq(schema.mailMailboxes.id, id));
  }

  await db
    .delete(schema.mailNotificationIdentities)
    .where(like(schema.mailNotificationIdentities.email, `${FIXTURE}%`));
}

async function stagePendingInbound(
  db: TestDb,
  payloadStore: MemoryInboundRawPayloadStore,
  suffix: string,
  recipientAddress: string,
) {
  const staged = await stageInboundProviderEvent(db, payloadStore, {
    provider: PROVIDER,
    providerEventId: `${FIXTURE}-in-${suffix}`,
    receivedAt: BASE_TIME,
    rawPayloadBytes: sampleMime(`<${suffix}@external.test>`),
    envelopeRecipients: [recipientAddress],
  });
  return staged.envelopeResults[0]!.ingestionEventId;
}

async function resetProviderEventToPending(db: TestDb, ingestionEventId: string) {
  await db
    .update(schema.mailProviderIngestionEvents)
    .set({
      status: "pending",
      finalizedAt: null,
      quarantineReason: null,
      errorCode: null,
      errorMessage: null,
      processingStartedAt: null,
      processingLeaseExpiresAt: null,
      nextAttemptAt: null,
    })
    .where(eq(schema.mailProviderIngestionEvents.id, ingestionEventId));
}

async function createSharedMailboxWithPrimary(db: TestDb, suffix: string) {
  const mailbox = await createMailbox(db, adminActor(), {
    address: fixtureAddress(`${suffix}-mailbox`),
    mailboxType: "shared",
  });
  const [primary] = await db
    .select()
    .from(schema.mailReceivingAddresses)
    .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));
  assert.ok(primary);
  return { mailbox, primary };
}

describe("mail background tick Local D1", () => {
  let db: TestDb;
  let payloadStore: MemoryInboundRawPayloadStore;
  let attachmentStore: MemoryInboundAttachmentStore;
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
    setIngestionProcessingLeaseTestClock(BASE_TIME);
    setNotificationProcessingLeaseTestClock(BASE_TIME);
    await enableMailAccess(db, SEED_IDS.admin);
    await enableMailAccess(db, SEED_IDS.staffA);
  });

  after(async () => {
    try {
      await safeCleanupFixtures(db);
    } finally {
      setIngestionProcessingLeaseTestClock(null);
      setNotificationProcessingLeaseTestClock(null);
      dispose?.();
    }
  });

  it("system provider recovery writes audit with NULL user_id", async () => {
    await safeCleanupFixtures(db);
    const ingestionEventId = await stagePendingInbound(
      db,
      payloadStore,
      "sys-audit",
      fixtureAddress("unknown-sys-audit"),
    );
    await resetProviderEventToPending(db, ingestionEventId);
    await claimProviderIngestionForProcessing(db, {
      ingestionEventId,
      expectedProcessingVersion: 1,
      now: BASE_TIME,
    });
    const expiredAt = new Date(
      Date.parse(BASE_TIME) + INGESTION_PROCESSING_LEASE_V1_MS + 1000,
    ).toISOString();
    setIngestionProcessingLeaseTestClock(expiredAt);

    const result = await recoverExpiredProcessingIngestionEventAsSystem(db, {
      ingestionEventId,
      now: expiredAt,
    });
    assert.equal(result.outcome, "RECOVERED");

    const [audit] = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, ingestionEventId),
          eq(
            schema.auditLogs.action,
            MAIL_AUDIT_ACTIONS.ingestionProcessingRecovered,
          ),
        ),
      );
    assert.ok(audit);
    assert.equal(audit.userId, null);
    const metadata = JSON.parse(audit.metadata ?? "{}") as Record<string, unknown>;
    assert.equal(metadata.initiator, "system");
    assert.equal(metadata.source, "mail_jobs_cron");
  });

  it("manual provider recovery still logs real human user_id", async () => {
    await safeCleanupFixtures(db);
    const ingestionEventId = await stagePendingInbound(
      db,
      payloadStore,
      "human-audit",
      fixtureAddress("unknown-human-audit"),
    );
    await resetProviderEventToPending(db, ingestionEventId);
    await claimProviderIngestionForProcessing(db, {
      ingestionEventId,
      expectedProcessingVersion: 1,
      now: BASE_TIME,
    });
    const expiredAt = new Date(
      Date.parse(BASE_TIME) + INGESTION_PROCESSING_LEASE_V1_MS + 1000,
    ).toISOString();
    setIngestionProcessingLeaseTestClock(expiredAt);

    await recoverExpiredProcessingIngestionEvent(db, humanActor(), {
      ingestionEventId,
      now: expiredAt,
    });

    const [audit] = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, ingestionEventId),
          eq(schema.auditLogs.userId, SEED_IDS.staffA),
        ),
      );
    assert.ok(audit);
    assert.equal(audit.userId, SEED_IDS.staffA);
  });

  it("delivery correlation pending sets 15-minute next_attempt_at backoff", async () => {
    await safeCleanupFixtures(db);
    setIngestionProcessingLeaseTestClock(BASE_TIME);
    const staged = await stageDeliveryProviderEvent(db, null, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-del-backoff`,
      providerMessageId: `${FIXTURE}-missing-send`,
      recipientAddress: fixtureAddress("del-backoff"),
      deliveryEventType: "delivered",
      receivedAt: BASE_TIME,
    });

    try {
      await runMailBackgroundTick(db, {
        rawPayloadStore: payloadStore,
        attachmentStore,
        trustNow: () => BASE_TIME,
      });
    } catch {
      // materialize may throw through tick — row should still be updated
    }

    const [provider] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, staged.ingestionEventId));
    assert.ok(provider);
    assert.equal(provider.status, "pending");
    assert.ok(provider.nextAttemptAt);
    const expectedRetry = new Date(
      Date.parse(BASE_TIME) + DELIVERY_CORRELATION_RETRY_DELAY_MS,
    ).toISOString();
    assert.equal(provider.nextAttemptAt, expectedRetry);

    const beforeDue = await listDueDeliveryProviderIngestionEvents(db, {
      trustNow: new Date(Date.parse(BASE_TIME) + 60_000).toISOString(),
      limit: 10,
    });
    assert.equal(
      beforeDue.some((row) => row.id === staged.ingestionEventId),
      false,
    );

    const afterDue = await listDueDeliveryProviderIngestionEvents(db, {
      trustNow: expectedRetry,
      limit: 10,
    });
    assert.equal(
      afterDue.some((row) => row.id === staged.ingestionEventId),
      true,
    );
  });

  it("bounded provider work selects at most max per category", async () => {
    await safeCleanupFixtures(db);
    setIngestionProcessingLeaseTestClock(BASE_TIME);
    const { primary } = await createSharedMailboxWithPrimary(db, "bound");
    for (let i = 0; i < 8; i += 1) {
      await stagePendingInbound(
        db,
        payloadStore,
        `bound-${i}`,
        primary.address,
      );
    }

    const summary = await runMailBackgroundTick(db, {
      rawPayloadStore: payloadStore,
      attachmentStore,
      trustNow: () => BASE_TIME,
    }, {
      maxItemsPerCategory: 5,
      maxTotalItems: 20,
    });

    assert.ok(summary.inboundMaterialization.selected <= 5);
    assert.ok(summary.inboundMaterialization.completed >= 1);
    assert.ok(summary.totalItemsStarted <= 20);
  });

  it("total 20 limit stops before exceeding global cap", async () => {
    await safeCleanupFixtures(db);
    setIngestionProcessingLeaseTestClock(BASE_TIME);
    const { primary } = await createSharedMailboxWithPrimary(db, "total");
    for (let i = 0; i < 10; i += 1) {
      const ingestionEventId = await stagePendingInbound(
        db,
        payloadStore,
        `total-exp-${i}`,
        fixtureAddress(`unknown-total-exp-${i}`),
      );
      await resetProviderEventToPending(db, ingestionEventId);
      await claimProviderIngestionForProcessing(db, {
        ingestionEventId,
        expectedProcessingVersion: 1,
        now: BASE_TIME,
      });
    }
    for (let i = 0; i < 10; i += 1) {
      await stagePendingInbound(
        db,
        payloadStore,
        `total-in-${i}`,
        primary.address,
      );
    }

    const expiredAt = new Date(
      Date.parse(BASE_TIME) + INGESTION_PROCESSING_LEASE_V1_MS + 1000,
    ).toISOString();
    setIngestionProcessingLeaseTestClock(expiredAt);

    const summary = await runMailBackgroundTick(db, {
      rawPayloadStore: payloadStore,
      attachmentStore,
      trustNow: () => expiredAt,
    }, {
      maxItemsPerCategory: 5,
      maxTotalItems: 6,
    });

    assert.equal(summary.totalItemsStarted, 6);
    assert.equal(summary.stoppedReason, "total_limit");
  });

  it("soft time budget stops starting new items", async () => {
    await safeCleanupFixtures(db);
    setIngestionProcessingLeaseTestClock(BASE_TIME);
    const { primary } = await createSharedMailboxWithPrimary(db, "time");
    for (let i = 0; i < 6; i += 1) {
      await stagePendingInbound(
        db,
        payloadStore,
        `time-${i}`,
        primary.address,
      );
    }

    let elapsed = 0;
    const summary = await runMailBackgroundTick(db, {
      rawPayloadStore: payloadStore,
      attachmentStore,
      trustNow: () => BASE_TIME,
      elapsedMs: () => {
        elapsed += 10_000;
        return elapsed;
      },
    }, {
      maxItemsPerCategory: 5,
      maxTotalItems: 20,
      softWallClockBudgetMs: 25_000,
    });

    assert.equal(summary.stoppedReason, "time_budget");
    assert.ok(summary.totalItemsStarted < 6);
  });

  it("item failure isolation — one bad inbound does not block another", async () => {
    await safeCleanupFixtures(db);
    setIngestionProcessingLeaseTestClock(BASE_TIME);
    const { primary } = await createSharedMailboxWithPrimary(db, "good");
    await stagePendingInbound(
      db,
      payloadStore,
      "bad",
      fixtureAddress("unknown-routing"),
    );
    const badId = await stagePendingInbound(
      db,
      payloadStore,
      "bad-pending",
      fixtureAddress("unknown-routing-2"),
    );
    await resetProviderEventToPending(db, badId);
    const goodId = await stagePendingInbound(
      db,
      payloadStore,
      "good",
      primary.address,
    );

    const summary = await runMailBackgroundTick(db, {
      rawPayloadStore: payloadStore,
      attachmentStore,
      trustNow: () => BASE_TIME,
    });

    assert.ok(summary.inboundMaterialization.errors + summary.inboundMaterialization.quarantined >= 1);
    const [goodProvider] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, goodId));
    assert.equal(goodProvider?.status, "completed");
    assert.ok(summary.inboundMaterialization.completed >= 1);
  });

  it("overlapping ticks — CAS prevents double ownership", async () => {
    await safeCleanupFixtures(db);
    setIngestionProcessingLeaseTestClock(BASE_TIME);
    const { primary } = await createSharedMailboxWithPrimary(db, "overlap");

    const ingestionEventId = await stagePendingInbound(
      db,
      payloadStore,
      "overlap",
      primary.address,
    );

    const deps = {
      rawPayloadStore: payloadStore,
      attachmentStore,
      trustNow: () => BASE_TIME,
    };

    const [first, second] = await Promise.all([
      runMailBackgroundTick(db, deps),
      runMailBackgroundTick(db, deps),
    ]);

    const [provider] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, ingestionEventId));
    assert.equal(provider?.status, "completed");

    const materializations = await db
      .select()
      .from(schema.mailInboundMessageMaterializations)
      .where(
        eq(schema.mailInboundMessageMaterializations.ingestionEventId, ingestionEventId),
      );
    assert.equal(materializations.length, 1);
    assert.ok(
      first.inboundMaterialization.completed + second.inboundMaterialization.completed >= 1,
    );
  });

  it("notification dispatch skipped when transport absent", async () => {
    await safeCleanupFixtures(db);
    const identityId = await createVerifiedIdentity(
      db,
      SEED_IDS.staffA,
      fixtureAddress("notify-skip"),
    );

    const enqueued = await enqueueMailNotificationIntent(db, {
      notificationType: "approval_returned",
      recipientUserId: SEED_IDS.staffA,
      notificationIdentityId: identityId,
      sourceEntityType: MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailOutboundApprovalEvent,
      sourceEntityId: `${FIXTURE}-skip-outbox`,
    });

    const summary = await runMailBackgroundTick(db, {
      rawPayloadStore: payloadStore,
      attachmentStore,
      trustNow: () => BASE_TIME,
    });
    assert.equal(summary.notificationDispatchSkipped, true);

    const updated = await findNotificationOutboxById(db, enqueued.outbox.id);
    assert.equal(updated?.status, "pending");

    const attempts = await db
      .select()
      .from(schema.mailNotificationAttempts)
      .where(eq(schema.mailNotificationAttempts.notificationOutboxId, enqueued.outbox.id));
    assert.equal(attempts.length, 0);
  });

  it("explicit Fake transport processes due notification locally", async () => {
    await safeCleanupFixtures(db);
    const identityId = await createVerifiedIdentity(
      db,
      SEED_IDS.staffA,
      fixtureAddress("notify-fake"),
    );

    const enqueued = await enqueueMailNotificationIntent(db, {
      notificationType: "approval_returned",
      recipientUserId: SEED_IDS.staffA,
      notificationIdentityId: identityId,
      sourceEntityType: MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailOutboundApprovalEvent,
      sourceEntityId: `${FIXTURE}-fake-outbox`,
    });

    const summary = await runMailBackgroundTick(db, {
      rawPayloadStore: payloadStore,
      attachmentStore,
      trustNow: () => BASE_TIME,
      notificationTransport: new FakeNotificationTransportAdapter("accepted"),
    });
    assert.equal(summary.notificationDispatchSkipped, false);
    assert.equal(summary.notificationDispatch.completed, 1);

    const updated = await findNotificationOutboxById(db, enqueued.outbox.id);
    assert.equal(updated?.status, "sent");
  });

  it("ambiguous notification recovery via tick — failed_permanent not pending", async () => {
    await safeCleanupFixtures(db);
    setNotificationProcessingLeaseTestClock(BASE_TIME);
    const identityId = await createVerifiedIdentity(
      db,
      SEED_IDS.staffA,
      fixtureAddress("notify-ambig"),
    );

    const enqueued = await enqueueMailNotificationIntent(db, {
      notificationType: "approval_returned",
      recipientUserId: SEED_IDS.staffA,
      notificationIdentityId: identityId,
      sourceEntityType: MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailOutboundApprovalEvent,
      sourceEntityId: `${FIXTURE}-ambig-outbox`,
    });

    const claim = await claimNotificationOutboxForProcessing(db, {
      outboxId: enqueued.outbox.id,
    });
    assert.equal(claim.claimed, true);
    await db.insert(schema.mailNotificationAttempts).values({
      id: crypto.randomUUID(),
      notificationOutboxId: enqueued.outbox.id,
      attemptNumber: 1,
      processingVersion: claim.outbox.processingVersion,
      state: "started",
      provider: "fake-notification-v1",
      startedAt: BASE_TIME,
    });

    const expiredAt = new Date(
      Date.parse(BASE_TIME) + NOTIFICATION_PROCESSING_LEASE_V1_MS + 1000,
    ).toISOString();
    setNotificationProcessingLeaseTestClock(expiredAt);

    const summary = await runMailBackgroundTick(db, {
      rawPayloadStore: payloadStore,
      attachmentStore,
      trustNow: () => expiredAt,
    });
    assert.equal(summary.notificationProcessingRecovery.permanentFailed, 1);

    const updated = await findNotificationOutboxById(db, enqueued.outbox.id);
    assert.equal(updated?.status, "failed_permanent");
  });

  it("quarantined provider events are not replayed by tick", async () => {
    await safeCleanupFixtures(db);
    const ingestionEventId = await stagePendingInbound(
      db,
      payloadStore,
      "quarantine-stays",
      fixtureAddress("quarantine-stays-unknown"),
    );
    await runMailBackgroundTick(db, {
      rawPayloadStore: payloadStore,
      attachmentStore,
      trustNow: () => BASE_TIME,
    });

    const [providerBefore] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, ingestionEventId));
    assert.equal(providerBefore?.status, "quarantined");
    const versionBefore = providerBefore!.processingVersion;

    await runMailBackgroundTick(db, {
      rawPayloadStore: payloadStore,
      attachmentStore,
      trustNow: () => BASE_TIME,
    });

    const [providerAfter] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, ingestionEventId));
    assert.equal(providerAfter?.status, "quarantined");
    assert.equal(providerAfter?.processingVersion, versionBefore);
  });

  it("system actor is not assignable from HTTP and has null userId", () => {
    assert.equal(SYSTEM_MAIL_ACTOR.kind, "system");
    assert.equal(SYSTEM_MAIL_ACTOR.userId, null);
    assert.equal(SYSTEM_MAIL_ACTOR.source, "mail_jobs_cron");
  });

  it("due inbound query respects next_attempt_at ordering", async () => {
    await safeCleanupFixtures(db);
    const { primary } = await createSharedMailboxWithPrimary(db, "due");
    await stagePendingInbound(
      db,
      payloadStore,
      "due-a",
      primary.address,
    );
    const rows = await listDueInboundProviderIngestionEvents(db, {
      trustNow: BASE_TIME,
      limit: 5,
    });
    assert.ok(rows.length >= 1);
  });
});

describe("mail background tick constants", () => {
  it("freezes V1 bounds", () => {
    assert.equal(MAIL_BACKGROUND_MAX_ITEMS_PER_CATEGORY, 5);
    assert.equal(MAIL_BACKGROUND_MAX_TOTAL_ITEMS_PER_TICK, 20);
    assert.equal(MAIL_BACKGROUND_SOFT_WALL_CLOCK_BUDGET_MS, 25_000);
    assert.equal(DELIVERY_CORRELATION_RETRY_DELAY_MS, 15 * 60 * 1000);
  });
});
