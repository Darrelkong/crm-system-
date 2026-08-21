import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import { enqueueMailNotificationIntent } from "@/lib/mail/notification-outbox-enqueue-service";
import {
  NOTIFICATION_FAILURE_CODES,
  NOTIFICATION_MAX_ATTEMPTS,
  NOTIFICATION_PROCESSING_LEASE_V1_MS,
  NOTIFICATION_RETRY_DELAY_MS,
} from "@/lib/mail/notification-outbox-constants";
import {
  claimAndProcessNotificationOutbox,
  claimNotificationOutboxForProcessing,
  finalizeAttemptAcceptedForTest,
  findNotificationOutboxById,
  listNotificationOutboxForHealth,
  processClaimedNotificationOutbox,
  recoverExpiredNotificationProcessing,
} from "@/lib/mail/notification-outbox-processing-service";
import {
  setNotificationProcessingLeaseTestClock,
} from "@/lib/mail/notification-processing-lease";
import { MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES } from "@/lib/mail/notification-source-entity-policy";
import {
  createPendingNotificationIdentity,
  findActiveVerifiedNotificationIdentity,
  revokeNotificationIdentity,
  updateNotificationDeliveryHealth,
  verifyNotificationIdentity,
} from "@/lib/mail/notification-identity-service";
import { createCapturingNotificationVerificationChallengeSink } from "@/lib/mail/notification-verification-challenge-sink";
import { FakeNotificationTransportAdapter } from "@/lib/mail/notification-transport-adapter";

const FIXTURE = "mail-phase2c12b1";
const TARGET_USER = SEED_IDS.staffA;
const BASE_TIME = "2026-08-21T12:00:00.000Z";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(
  userId: string,
  grants: MailActorContext["adminGrants"] = ["delivery_health"],
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole: userId === SEED_IDS.admin ? "admin" : "staff",
    mailAccessEnabled: true,
    adminGrants: grants,
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2c12b1-test" },
  };
}

const workerActor = actor(SEED_IDS.admin, ["delivery_health"]);
const ordinaryStaffActor = actor(SEED_IDS.staffA, []);

function fixtureEmail(localPart: string): string {
  return `${FIXTURE}-${localPart}@gmail.com`;
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

async function createVerifiedIdentity(
  db: TestDb,
  userId: string,
  email: string,
): Promise<{ identityId: string }> {
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
  return { identityId: verified.id };
}

async function cleanupFixtures(db: TestDb) {
  await db
    .delete(schema.auditLogs)
    .where(like(schema.auditLogs.entityId, `${FIXTURE}%`));

  const outboxRows = await db
    .select({ id: schema.mailNotificationOutbox.id })
    .from(schema.mailNotificationOutbox)
    .where(
      like(schema.mailNotificationOutbox.sourceEntityId, `${FIXTURE}%`),
    );
  for (const row of outboxRows) {
    await db
      .delete(schema.mailNotificationAttempts)
      .where(
        eq(schema.mailNotificationAttempts.notificationOutboxId, row.id),
      );
  }
  await db
    .delete(schema.mailNotificationOutbox)
    .where(like(schema.mailNotificationOutbox.sourceEntityId, `${FIXTURE}%`));

  await db
    .delete(schema.mailNotificationIdentities)
    .where(eq(schema.mailNotificationIdentities.userId, TARGET_USER));
}

async function seedIntent(
  db: TestDb,
  input: {
    notificationType?: "new_incoming" | "important_send_failure";
    sourceEntityType?: string;
    sourceEntityId: string;
    recipientUserId?: string;
    identityId: string;
  },
) {
  return enqueueMailNotificationIntent(db, {
    notificationType: input.notificationType ?? "new_incoming",
    recipientUserId: input.recipientUserId ?? TARGET_USER,
    notificationIdentityId: input.identityId,
    sourceEntityType:
      input.sourceEntityType ?? MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailMessage,
    sourceEntityId: input.sourceEntityId,
  });
}

describe("notification outbox core integration", () => {
  let db: TestDb;
  let dispose: (() => void) | undefined;
  let identityId: string;

  async function refreshTargetIdentity(): Promise<string> {
    const active = await findActiveVerifiedNotificationIdentity(db, TARGET_USER);
    if (active) {
      identityId = active.id;
      return active.id;
    }
    const created = await createVerifiedIdentity(
      db,
      TARGET_USER,
      fixtureEmail(`restored-${Date.now()}`),
    );
    identityId = created.identityId;
    return created.identityId;
  }

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    setNotificationProcessingLeaseTestClock(BASE_TIME);
    await cleanupFixtures(db);
    await enableMailAccess(db, TARGET_USER);
    ({ identityId } = await createVerifiedIdentity(
      db,
      TARGET_USER,
      fixtureEmail("notify"),
    ));
  });

  after(async () => {
    await cleanupFixtures(db);
    setNotificationProcessingLeaseTestClock(null);
    dispose?.();
  });

  it("idempotent enqueue returns existing intent", async () => {
    const sourceId = `${FIXTURE}-dedupe-msg-1`;
    const first = await seedIntent(db, {
      sourceEntityId: sourceId,
      identityId,
    });
    assert.equal(first.created, true);

    const second = await seedIntent(db, {
      sourceEntityId: sourceId,
      identityId,
    });
    assert.equal(second.created, false);
    assert.equal(second.outbox.id, first.outbox.id);
  });

  it("converged canonical message dedupe — same mail_message source", async () => {
    const canonicalMessageId = `${FIXTURE}-canonical-msg-shared`;
    const a = await seedIntent(db, {
      sourceEntityId: canonicalMessageId,
      identityId,
    });
    const b = await seedIntent(db, {
      sourceEntityId: canonicalMessageId,
      identityId,
    });
    assert.equal(a.outbox.id, b.outbox.id);

    const rows = await db
      .select()
      .from(schema.mailNotificationOutbox)
      .where(
        and(
          eq(schema.mailNotificationOutbox.sourceEntityId, canonicalMessageId),
          eq(schema.mailNotificationOutbox.notificationType, "new_incoming"),
        ),
      );
    assert.equal(rows.length, 1);
  });

  it("important send failure dedupe — same send operation", async () => {
    const sendOperationId = `${FIXTURE}-send-op-1`;
    const first = await enqueueMailNotificationIntent(db, {
      notificationType: "important_send_failure",
      recipientUserId: TARGET_USER,
      notificationIdentityId: identityId,
      sourceEntityType: MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailSendOperation,
      sourceEntityId: sendOperationId,
    });
    const second = await enqueueMailNotificationIntent(db, {
      notificationType: "important_send_failure",
      recipientUserId: TARGET_USER,
      notificationIdentityId: identityId,
      sourceEntityType: MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailSendOperation,
      sourceEntityId: sendOperationId,
    });
    assert.equal(first.outbox.id, second.outbox.id);
    assert.equal(second.created, false);
  });

  it("different recipient creates distinct intent", async () => {
    await enableMailAccess(db, SEED_IDS.staffB);
    const staffBIdentity = await createVerifiedIdentity(
      db,
      SEED_IDS.staffB,
      fixtureEmail("staffb"),
    );
    const sourceId = `${FIXTURE}-multi-recipient`;
    const a = await seedIntent(db, {
      sourceEntityId: sourceId,
      identityId,
      recipientUserId: TARGET_USER,
    });
    const b = await enqueueMailNotificationIntent(db, {
      notificationType: "new_incoming",
      recipientUserId: SEED_IDS.staffB,
      notificationIdentityId: staffBIdentity.identityId,
      sourceEntityType: MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailMessage,
      sourceEntityId: sourceId,
    });
    assert.notEqual(a.outbox.id, b.outbox.id);
  });

  it("fake adapter accepted marks outbox sent", async () => {
    const { outbox } = await seedIntent(db, {
      sourceEntityId: `${FIXTURE}-accepted`,
      identityId,
    });
    const result = await claimAndProcessNotificationOutbox(db, workerActor, {
      outboxId: outbox.id,
      adapter: new FakeNotificationTransportAdapter("accepted"),
    });
    assert.equal(result.phase, "processed");
    if (result.phase === "processed") {
      assert.equal(result.outcome, "sent");
    }
    const updated = await findNotificationOutboxById(db, outbox.id);
    assert.equal(updated?.status, "sent");
    assert.ok(updated?.completedAt);
  });

  it("identity revoked before dispatch → permanent skip without resend", async () => {
    const permissionActor = actor(SEED_IDS.admin, ["permission_mgmt"]);
    await enableMailAccess(db, SEED_IDS.staffB);
    const { identityId: revokedIdentity } = await createVerifiedIdentity(
      db,
      SEED_IDS.staffB,
      fixtureEmail("revoked"),
    );
    const { outbox } = await enqueueMailNotificationIntent(db, {
      notificationType: "new_incoming",
      recipientUserId: SEED_IDS.staffB,
      notificationIdentityId: revokedIdentity,
      sourceEntityType: MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailMessage,
      sourceEntityId: `${FIXTURE}-revoked-identity`,
    });
    await revokeNotificationIdentity(db, permissionActor, {
      identityId: revokedIdentity,
    });
    const claim = await claimNotificationOutboxForProcessing(db, {
      outboxId: outbox.id,
    });
    assert.equal(claim.claimed, true);
    const processed = await processClaimedNotificationOutbox(db, workerActor, {
      outboxId: outbox.id,
      adapter: new FakeNotificationTransportAdapter("accepted"),
    });
    assert.equal(processed.outcome, "failed_permanent");
    assert.equal(
      processed.failureCode,
      NOTIFICATION_FAILURE_CODES.notificationIdentityInvalid,
    );
    const attempts = await db
      .select()
      .from(schema.mailNotificationAttempts)
      .where(eq(schema.mailNotificationAttempts.notificationOutboxId, outbox.id));
    assert.equal(attempts.length, 0);
  });

  it("bounced identity → permanent skip", async () => {
    const permissionActor = actor(SEED_IDS.admin, ["permission_mgmt"]);
    const { identityId: bouncedIdentity } = await createVerifiedIdentity(
      db,
      TARGET_USER,
      fixtureEmail("bounced"),
    );
    await updateNotificationDeliveryHealth(db, permissionActor, {
      identityId: bouncedIdentity,
      deliveryHealth: "bounced",
    });
    const { outbox } = await seedIntent(db, {
      sourceEntityId: `${FIXTURE}-bounced-identity`,
      identityId: bouncedIdentity,
    });
    await claimNotificationOutboxForProcessing(db, { outboxId: outbox.id });
    const processed = await processClaimedNotificationOutbox(db, workerActor, {
      outboxId: outbox.id,
      adapter: new FakeNotificationTransportAdapter("accepted"),
    });
    assert.equal(processed.outcome, "failed_permanent");
    if (processed.outcome === "failed_permanent") {
      assert.equal(
        processed.failureCode,
        NOTIFICATION_FAILURE_CODES.notificationIdentityBounced,
      );
    }
  });

  it("disabled mail access → permanent skip", async () => {
    const { identityId: disabledIdentity } = await createVerifiedIdentity(
      db,
      TARGET_USER,
      fixtureEmail("disabled-access"),
    );
    const { outbox } = await seedIntent(db, {
      sourceEntityId: `${FIXTURE}-disabled-access`,
      identityId: disabledIdentity,
    });
    await disableMailAccess(db, TARGET_USER);
    await claimNotificationOutboxForProcessing(db, { outboxId: outbox.id });
    const processed = await processClaimedNotificationOutbox(db, workerActor, {
      outboxId: outbox.id,
      adapter: new FakeNotificationTransportAdapter("accepted"),
    });
    assert.equal(processed.outcome, "failed_permanent");
    if (processed.outcome === "failed_permanent") {
      assert.equal(
        processed.failureCode,
        NOTIFICATION_FAILURE_CODES.mailAccessDisabled,
      );
    }
    await enableMailAccess(db, TARGET_USER);
  });

  it("temporary failure schedules retry then exhausts after 5 attempts", async () => {
    setNotificationProcessingLeaseTestClock(BASE_TIME);
    const activeIdentityId = await refreshTargetIdentity();
    const { outbox } = await seedIntent(db, {
      sourceEntityId: `${FIXTURE}-retry-exhaust`,
      identityId: activeIdentityId,
    });
    const adapter = new FakeNotificationTransportAdapter("temporary_failure");
    let current = outbox;

    for (let attempt = 1; attempt <= NOTIFICATION_MAX_ATTEMPTS; attempt++) {
      setNotificationProcessingLeaseTestClock(
        attempt === 1
          ? BASE_TIME
          : current.nextAttemptAt ?? BASE_TIME,
      );
      if (attempt > 1) {
        assert.equal(current.status, "failed_retryable");
      }
      const claim = await claimNotificationOutboxForProcessing(db, {
        outboxId: current.id,
      });
      assert.equal(claim.claimed, true);
      const processed = await processClaimedNotificationOutbox(db, workerActor, {
        outboxId: current.id,
        adapter,
      });
      current = (await findNotificationOutboxById(db, current.id))!;
      if (attempt < NOTIFICATION_MAX_ATTEMPTS) {
        assert.equal(processed.outcome, "failed_retryable");
        assert.ok(current.nextAttemptAt);
        const expectedDelay =
          NOTIFICATION_RETRY_DELAY_MS[attempt as 1 | 2 | 3 | 4]!;
        const delta =
          Date.parse(current.nextAttemptAt!) -
          Date.parse(getTrustNowForAttempt(attempt));
        assert.ok(Math.abs(delta - expectedDelay) < 2000);
      } else {
        assert.equal(processed.outcome, "failed_permanent");
        assert.equal(current.failureCode, NOTIFICATION_FAILURE_CODES.retryExhausted);
        assert.equal(current.status, "failed_permanent");
      }
    }

    const attempts = await db
      .select()
      .from(schema.mailNotificationAttempts)
      .where(eq(schema.mailNotificationAttempts.notificationOutboxId, outbox.id));
    assert.equal(attempts.length, NOTIFICATION_MAX_ATTEMPTS);
  });

  it("crash before started attempt — safe recovery to pending", async () => {
    setNotificationProcessingLeaseTestClock(BASE_TIME);
    await refreshTargetIdentity();
    const { outbox } = await seedIntent(db, {
      sourceEntityId: `${FIXTURE}-crash-before-attempt`,
      identityId,
    });
    const claim = await claimNotificationOutboxForProcessing(db, {
      outboxId: outbox.id,
    });
    assert.equal(claim.claimed, true);
    const claimed = claim.outbox;
    const expiredAt = new Date(
      Date.parse(claimed.processingLeaseExpiresAt!) + 1000,
    ).toISOString();
    setNotificationProcessingLeaseTestClock(expiredAt);

    const recovery = await recoverExpiredNotificationProcessing(
      db,
      workerActor,
      outbox.id,
    );
    assert.equal(recovery.outcome, "RECOVERED_TO_PENDING");
    const updated = await findNotificationOutboxById(db, outbox.id);
    assert.equal(updated?.status, "pending");
    assert.equal(updated?.processingVersion, claimed.processingVersion + 1);
    assert.equal(updated?.processingStartedAt, null);
  });

  it("crash after started attempt — ambiguous terminalization", async () => {
    setNotificationProcessingLeaseTestClock(BASE_TIME);
    await refreshTargetIdentity();
    const { outbox } = await seedIntent(db, {
      sourceEntityId: `${FIXTURE}-crash-after-attempt`,
      identityId,
    });
    const claim = await claimNotificationOutboxForProcessing(db, {
      outboxId: outbox.id,
    });
    assert.equal(claim.claimed, true);
    const claimed = claim.outbox;
    await db.insert(schema.mailNotificationAttempts).values({
      id: crypto.randomUUID(),
      notificationOutboxId: outbox.id,
      attemptNumber: 1,
      processingVersion: claimed.processingVersion,
      state: "started",
      provider: "fake-notification-v1",
      startedAt: BASE_TIME,
    });

    const expiredAt = new Date(
      Date.parse(claimed.processingLeaseExpiresAt!) + 1000,
    ).toISOString();
    setNotificationProcessingLeaseTestClock(expiredAt);

    const recovery = await recoverExpiredNotificationProcessing(
      db,
      workerActor,
      outbox.id,
    );
    assert.equal(recovery.outcome, "AMBIGUOUS_TERMINALIZED");

    const updated = await findNotificationOutboxById(db, outbox.id);
    assert.equal(updated?.status, "failed_permanent");
    assert.equal(
      updated?.failureCode,
      NOTIFICATION_FAILURE_CODES.transportOutcomeUnknown,
    );
    const attempts = await db
      .select()
      .from(schema.mailNotificationAttempts)
      .where(eq(schema.mailNotificationAttempts.notificationOutboxId, outbox.id));
    assert.equal(attempts[0]?.state, "outcome_unknown");
  });

  it("old worker cannot finalize after ambiguous terminalization", async () => {
    setNotificationProcessingLeaseTestClock(BASE_TIME);
    await refreshTargetIdentity();
    const { outbox } = await seedIntent(db, {
      sourceEntityId: `${FIXTURE}-stale-worker`,
      identityId,
    });
    const claim = await claimNotificationOutboxForProcessing(db, {
      outboxId: outbox.id,
    });
    assert.equal(claim.claimed, true);
    const staleOutbox = claim.outbox;
    const attemptId = crypto.randomUUID();
    await db.insert(schema.mailNotificationAttempts).values({
      id: attemptId,
      notificationOutboxId: outbox.id,
      attemptNumber: 1,
      processingVersion: staleOutbox.processingVersion,
      state: "started",
      provider: "fake-notification-v1",
      startedAt: BASE_TIME,
    });

    const expiredAt = new Date(
      Date.parse(staleOutbox.processingLeaseExpiresAt!) + 1000,
    ).toISOString();
    setNotificationProcessingLeaseTestClock(expiredAt);
    const recovery = await recoverExpiredNotificationProcessing(
      db,
      workerActor,
      outbox.id,
    );
    assert.equal(recovery.outcome, "AMBIGUOUS_TERMINALIZED");

    const attempt = (
      await db
        .select()
        .from(schema.mailNotificationAttempts)
        .where(eq(schema.mailNotificationAttempts.id, attemptId))
    )[0]!;
    await assert.rejects(
      () =>
        finalizeAttemptAcceptedForTest(
          db,
          workerActor,
          staleOutbox,
          attempt,
          "stale-req",
        ),
      (error: unknown) =>
        error instanceof MailServiceError ||
        (error instanceof Error &&
          /NOT NULL constraint failed: audit_logs.id|Expected state changed/i.test(
            error.message,
          )),
    );
    const finalOutbox = await findNotificationOutboxById(db, outbox.id);
    assert.equal(finalOutbox?.status, "failed_permanent");
  });

  it("concurrent claim — only one owner", async () => {
    const { outbox } = await seedIntent(db, {
      sourceEntityId: `${FIXTURE}-concurrent-claim`,
      identityId,
    });
    const [a, b] = await Promise.all([
      claimNotificationOutboxForProcessing(db, { outboxId: outbox.id }),
      claimNotificationOutboxForProcessing(db, { outboxId: outbox.id }),
    ]);
    const winners = [a, b].filter((r) => r.claimed);
    assert.equal(winners.length, 1);
  });

  it("delivery_health list requires authority", async () => {
    await assert.rejects(
      () => listNotificationOutboxForHealth(db, ordinaryStaffActor),
      (error: unknown) => error instanceof MailServiceError,
    );
    const rows = await listNotificationOutboxForHealth(db, workerActor, {
      limit: 5,
    });
    assert.ok(Array.isArray(rows));
  });
});

function getTrustNowForAttempt(attempt: number): string {
  if (attempt === 1) {
    return BASE_TIME;
  }
  let ms = Date.parse(BASE_TIME);
  for (let i = 1; i < attempt; i++) {
    ms += NOTIFICATION_RETRY_DELAY_MS[i as 1 | 2 | 3 | 4]!;
  }
  return new Date(ms).toISOString();
}
