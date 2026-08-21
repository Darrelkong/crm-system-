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
import {
  buildInboundProviderCompletedCasUpdate,
  runGuardedUpdate,
} from "@/lib/mail/guarded-batch";
import {
  recoverExpiredProcessingIngestionEvent,
  listStuckProcessingIngestionEvents,
} from "@/lib/mail/ingestion-processing-recovery-service";
import { MemoryInboundRawPayloadStore } from "@/lib/mail/inbound-raw-payload-store";
import { stageInboundProviderEvent } from "@/lib/mail/inbound-provider-staging-service";
import { claimProviderIngestionForProcessing } from "@/lib/mail/provider-ingestion-claim";
import {
  computeIngestionProcessingLease,
  INGESTION_PROCESSING_LEASE_V1_MS,
  setIngestionProcessingLeaseTestClock,
} from "@/lib/mail/provider-ingestion-processing-lease";
import { assertMailDeliveryHealth } from "@/lib/permissions/mail";

const FIXTURE = "mail-phase2c12a1";
const PROVIDER = "fake-local";
const RECEIVED_AT = "2026-08-21T10:00:00.000Z";
const CLAIM_AT = "2026-08-21T10:00:00.000Z";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

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
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2c12a1-test" },
  };
}

const superAdminActor = actor(SEED_IDS.admin, ["super_admin"]);
const deliveryHealthActor = actor(SEED_IDS.staffA, ["delivery_health"]);
const accountMgmtActor = actor(SEED_IDS.staffA, ["account_mgmt"]);
const ordinaryStaffActor = actor(SEED_IDS.staffA, []);

function fixtureAddress(localPart: string): string {
  return `${FIXTURE}-${localPart}@echfronthk.com`;
}

function sampleMime(): Uint8Array {
  return new TextEncoder().encode(
    "From: sender@external.test\r\nTo: ignored@example.com\r\nSubject: lease\r\nMessage-ID: <lease@external.test>\r\n\r\nbody",
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

async function cleanupFixtures(db: TestDb) {
  await db
    .delete(schema.auditLogs)
    .where(
      like(
        schema.auditLogs.action,
        `${MAIL_AUDIT_ACTIONS.ingestionProcessingRecovered}%`,
      ),
    );

  const providerEvents = await db
    .select({ id: schema.mailProviderIngestionEvents.id })
    .from(schema.mailProviderIngestionEvents)
    .where(like(schema.mailProviderIngestionEvents.providerEventId, `${FIXTURE}%`));

  const ingestionIds = providerEvents.map((row) => row.id);
  if (ingestionIds.length) {
    await db.delete(schema.mailInboundIngestionEvents).where(
      like(schema.mailInboundIngestionEvents.envelopeRecipientAddress, `${FIXTURE}%`),
    );
    await db
      .delete(schema.mailProviderIngestionEvents)
      .where(like(schema.mailProviderIngestionEvents.providerEventId, `${FIXTURE}%`));
  }
}

async function stageUnknownQuarantined(db: TestDb, payloadStore: MemoryInboundRawPayloadStore) {
  const staged = await stageInboundProviderEvent(db, payloadStore, {
    provider: PROVIDER,
    providerEventId: `${FIXTURE}-evt-${crypto.randomUUID()}`,
    receivedAt: RECEIVED_AT,
    rawPayloadBytes: sampleMime(),
    envelopeRecipients: [fixtureAddress(`unknown-${crypto.randomUUID()}`)],
  });
  return staged.envelopeResults[0]!.ingestionEventId;
}

async function claimPendingEvent(
  db: TestDb,
  ingestionEventId: string,
  now = CLAIM_AT,
) {
  const [provider] = await db
    .select()
    .from(schema.mailProviderIngestionEvents)
    .where(eq(schema.mailProviderIngestionEvents.id, ingestionEventId))
    .limit(1);
  assert.ok(provider);
  assert.equal(provider.status, "pending");
  return claimProviderIngestionForProcessing(db, {
    ingestionEventId,
    expectedProcessingVersion: provider.processingVersion,
    now,
  });
}

describe("0065 migration runtime Local D1", () => {
  it("provider ingestion table exposes lease columns after 0065", async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    const db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);

    const rows = await db
      .select({
        processingStartedAt: schema.mailProviderIngestionEvents.processingStartedAt,
        processingLeaseExpiresAt:
          schema.mailProviderIngestionEvents.processingLeaseExpiresAt,
      })
      .from(schema.mailProviderIngestionEvents)
      .limit(1);
    assert.ok(Array.isArray(rows));

    proxy.dispose?.();
  });
});

describe("processing recovery Local D1", () => {
  let db: TestDb;
  let payloadStore: MemoryInboundRawPayloadStore;
  let dispose: (() => void) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    setIngestionProcessingLeaseTestClock(CLAIM_AT);
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    payloadStore = new MemoryInboundRawPayloadStore();
    await enableMailAccess(db, SEED_IDS.admin);
    await enableMailAccess(db, SEED_IDS.staffA);
    await cleanupFixtures(db);
  });

  after(async () => {
    setIngestionProcessingLeaseTestClock(null);
    await cleanupFixtures(db);
    dispose?.();
  });

  it("claim sets 15-minute lease atomically", async () => {
    await cleanupFixtures(db);
    const eventId = await stageUnknownQuarantined(db, payloadStore);
    await db
      .update(schema.mailProviderIngestionEvents)
      .set({
        status: "pending",
        processingVersion: 1,
        finalizedAt: null,
        quarantineReason: null,
        nextAttemptAt: null,
        processingStartedAt: null,
        processingLeaseExpiresAt: null,
      })
      .where(eq(schema.mailProviderIngestionEvents.id, eventId));

    await claimPendingEvent(db, eventId, CLAIM_AT);

    const [provider] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, eventId));
    assert.equal(provider?.status, "processing");
    assert.equal(provider?.processingVersion, 2);
    assert.equal(provider?.processingStartedAt, CLAIM_AT);
    assert.equal(
      provider?.processingLeaseExpiresAt,
      computeIngestionProcessingLease(CLAIM_AT).processingLeaseExpiresAt,
    );
    assert.equal(INGESTION_PROCESSING_LEASE_V1_MS, 15 * 60 * 1000);
  });

  it("early recovery refused before lease expiry", async () => {
    await cleanupFixtures(db);
    const eventId = await stageUnknownQuarantined(db, payloadStore);
    await db
      .update(schema.mailProviderIngestionEvents)
      .set({
        status: "pending",
        finalizedAt: null,
        quarantineReason: null,
        processingStartedAt: null,
        processingLeaseExpiresAt: null,
      })
      .where(eq(schema.mailProviderIngestionEvents.id, eventId));
    await claimPendingEvent(db, eventId, CLAIM_AT);

    const result = await recoverExpiredProcessingIngestionEvent(
      db,
      deliveryHealthActor,
      {
        ingestionEventId: eventId,
        now: "2026-08-21T10:14:59.999Z",
      },
    );
    assert.equal(result.outcome, "RECOVERY_NOT_READY");

    const [provider] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, eventId));
    assert.equal(provider?.status, "processing");
    assert.equal(provider?.processingVersion, 2);
  });

  it("expired recovery releases processing to pending with audit", async () => {
    await cleanupFixtures(db);
    const eventId = await stageUnknownQuarantined(db, payloadStore);
    await db
      .update(schema.mailProviderIngestionEvents)
      .set({
        status: "pending",
        finalizedAt: null,
        quarantineReason: null,
        processingStartedAt: null,
        processingLeaseExpiresAt: null,
      })
      .where(eq(schema.mailProviderIngestionEvents.id, eventId));
    await claimPendingEvent(db, eventId, CLAIM_AT);

    const result = await recoverExpiredProcessingIngestionEvent(
      db,
      superAdminActor,
      {
        ingestionEventId: eventId,
        now: "2026-08-21T10:15:00.000Z",
      },
    );
    assert.equal(result.outcome, "RECOVERED");
    assert.equal(result.status, "pending");
    assert.equal(result.processingVersion, 3);

    const [provider] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, eventId));
    assert.equal(provider?.status, "pending");
    assert.equal(provider?.processingStartedAt, null);
    assert.equal(provider?.processingLeaseExpiresAt, null);

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, MAIL_AUDIT_ACTIONS.ingestionProcessingRecovered),
          eq(schema.auditLogs.entityId, eventId),
        ),
      );
    assert.equal(audits.length, 1);
  });

  it("legacy unleased processing refuses recovery", async () => {
    await cleanupFixtures(db);
    const eventId = await stageUnknownQuarantined(db, payloadStore);
    await db
      .update(schema.mailProviderIngestionEvents)
      .set({
        status: "processing",
        processingVersion: 2,
        finalizedAt: null,
        quarantineReason: null,
        nextAttemptAt: null,
        processingStartedAt: null,
        processingLeaseExpiresAt: null,
      })
      .where(eq(schema.mailProviderIngestionEvents.id, eventId));

    const result = await recoverExpiredProcessingIngestionEvent(
      db,
      deliveryHealthActor,
      { ingestionEventId: eventId, now: "2026-08-21T11:00:00.000Z" },
    );
    assert.equal(result.outcome, "LEGACY_PROCESSING_UNLEASED");

    const [provider] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, eventId));
    assert.equal(provider?.status, "processing");
    assert.equal(provider?.processingVersion, 2);
  });

  it("old worker CAS fails after recovery increments version", async () => {
    await cleanupFixtures(db);
    const eventId = await stageUnknownQuarantined(db, payloadStore);
    await db
      .update(schema.mailProviderIngestionEvents)
      .set({
        status: "pending",
        finalizedAt: null,
        quarantineReason: null,
        processingStartedAt: null,
        processingLeaseExpiresAt: null,
      })
      .where(eq(schema.mailProviderIngestionEvents.id, eventId));
    const processingVersion = await claimPendingEvent(db, eventId, CLAIM_AT);

    await recoverExpiredProcessingIngestionEvent(db, deliveryHealthActor, {
      ingestionEventId: eventId,
      now: "2026-08-21T10:15:00.000Z",
    });

    await assert.rejects(
      () =>
        runGuardedUpdate(
          db,
          buildInboundProviderCompletedCasUpdate(
            db,
            { ingestionEventId: eventId, completedProcessingVersion: processingVersion + 1 },
            {
              processingProcessingVersion: processingVersion,
              finalizedAt: new Date().toISOString(),
            },
          ),
          "stale worker completion should fail",
        ),
      (error: unknown) =>
        error instanceof MailServiceError &&
        /CAS|Expected state changed|stale/i.test(error.message),
    );
  });

  it("concurrent recovery allows at most one success", async () => {
    await cleanupFixtures(db);
    const eventId = await stageUnknownQuarantined(db, payloadStore);
    await db
      .update(schema.mailProviderIngestionEvents)
      .set({
        status: "pending",
        finalizedAt: null,
        quarantineReason: null,
        processingStartedAt: null,
        processingLeaseExpiresAt: null,
      })
      .where(eq(schema.mailProviderIngestionEvents.id, eventId));
    await claimPendingEvent(db, eventId, CLAIM_AT);

    const settled = await Promise.allSettled([
      recoverExpiredProcessingIngestionEvent(db, deliveryHealthActor, {
        ingestionEventId: eventId,
        now: "2026-08-21T10:15:00.000Z",
      }),
      recoverExpiredProcessingIngestionEvent(db, deliveryHealthActor, {
        ingestionEventId: eventId,
        now: "2026-08-21T10:15:00.000Z",
      }),
    ]);

    const recovered = settled.filter(
      (result) =>
        result.status === "fulfilled" && result.value.outcome === "RECOVERED",
    );
    const rejected = settled.filter((result) => result.status === "rejected");
    assert.equal(recovered.length, 1);
    assert.equal(rejected.length, 1);

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, MAIL_AUDIT_ACTIONS.ingestionProcessingRecovered),
          eq(schema.auditLogs.entityId, eventId),
        ),
      );
    assert.equal(audits.length, 1);
  });

  it("authorization: delivery_health and super_admin only", () => {
    assert.doesNotThrow(() => assertMailDeliveryHealth(deliveryHealthActor));
    assert.doesNotThrow(() => assertMailDeliveryHealth(superAdminActor));
    assert.throws(() => assertMailDeliveryHealth(accountMgmtActor));
    assert.throws(() => assertMailDeliveryHealth(ordinaryStaffActor));
  });

  it("list stuck processing identifies lease states safely", async () => {
    await cleanupFixtures(db);
    const eventId = await stageUnknownQuarantined(db, payloadStore);
    await db
      .update(schema.mailProviderIngestionEvents)
      .set({
        status: "pending",
        finalizedAt: null,
        quarantineReason: null,
        processingStartedAt: null,
        processingLeaseExpiresAt: null,
      })
      .where(eq(schema.mailProviderIngestionEvents.id, eventId));
    await claimPendingEvent(db, eventId, CLAIM_AT);

    const active = await listStuckProcessingIngestionEvents(db, deliveryHealthActor);
    const match = active.find((item) => item.ingestionEventId === eventId);
    assert.ok(match);
    assert.equal(match.recoveryClassification, "lease_active");
    assert.equal(match.recoverable, false);
    assert.equal("payloadStorageKey" in match, false);
  });
});
