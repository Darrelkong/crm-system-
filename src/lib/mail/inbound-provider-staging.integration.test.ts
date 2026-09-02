import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { computeInboundPayloadContentHash } from "@/lib/mail/inbound-payload-hash";
import { INBOUND_QUARANTINE_REASONS } from "@/lib/mail/inbound-quarantine-reasons";
import {
  createInboundRawPayloadStore,
  FailingInboundRawPayloadStore,
  MemoryInboundRawPayloadStore,
} from "@/lib/mail/inbound-raw-payload-store";
import {
  stageInboundProviderEvent,
  stageInboundProviderEventWithBatchFailure,
} from "@/lib/mail/inbound-provider-staging-service";
import { setInboundFallbackMailbox } from "@/lib/mail/inbound-fallback-config-service";
import { createMailbox } from "@/lib/mail/mailbox-service";

const FIXTURE = "mail-phase2c9c";
const PROVIDER = "fixture-provider";
const RECEIVED_AT = "2026-08-20T14:00:00.000Z";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function superAdminActor(): MailActorContext {
  return {
    userId: SEED_IDS.admin,
    sessionId: null,
    crmRole: "admin",
    mailAccessEnabled: true,
    adminGrants: ["super_admin"],
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2c9c-test" },
  };
}

function fixtureAddress(localPart: string): string {
  return `${FIXTURE}-${localPart}@echfronthk.com`;
}

function sampleMime(): Uint8Array {
  return new TextEncoder().encode(
    "From: sender@external.test\r\nTo: ignored@example.com\r\nSubject: ignored\r\n\r\nbody",
  );
}

async function cleanupFixtures(db: TestDb) {
  await db
    .delete(schema.auditLogs)
    .where(like(schema.auditLogs.action, `${MAIL_AUDIT_ACTIONS.inboundProviderStaged}%`));
  await db.delete(schema.mailInboundMessageMaterializations);
  await db.delete(schema.mailInboundIngestionEvents);
  await db.delete(schema.mailProviderIngestionEvents);
  await db.delete(schema.mailOutboundMessageMaterializations);
  await db.delete(schema.mailDeliveryEventMaterializations);
  await db.delete(schema.mailDeliveryIngestionEvents);
  await db.delete(schema.mailDeliveryEvents);
  await db.delete(schema.mailMessageReadStates);
  await db.delete(schema.mailMessageAttachments);
  await db.delete(schema.mailMessageRecipients);
  await db.delete(schema.mailMessageBodies);
  await db
    .update(schema.mailDrafts)
    .set({ replyToMessageId: null });
  await db
    .update(schema.mailOutboundRevisions)
    .set({ replyToMessageId: null });
  await db
    .update(schema.mailMessages)
    .set({ replyToMessageId: null });
  await db.delete(schema.mailMessages);
  await db.delete(schema.mailCompanyConfig);
  await db
    .delete(schema.mailReceivingAddresses)
    .where(like(schema.mailReceivingAddresses.address, `${FIXTURE}%`));

  const mailboxes = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.address, `${FIXTURE}%`));
  for (const { id } of mailboxes) {
    await db
      .delete(schema.mailMailboxMembers)
      .where(eq(schema.mailMailboxMembers.mailboxId, id));
  }
  await db
    .delete(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.address, `${FIXTURE}%`));
}

async function insertReceivingAddress(
  db: TestDb,
  input: {
    id: string;
    mailboxId: string;
    address: string;
    status: "active" | "suspended" | "retired";
    addressType?: "primary" | "alias";
  },
) {
  const now = new Date().toISOString();
  await db.insert(schema.mailReceivingAddresses).values({
    id: input.id,
    mailboxId: input.mailboxId,
    address: input.address,
    addressType: input.addressType ?? "primary",
    status: input.status,
    createdAt: now,
    updatedAt: now,
    retiredAt: input.status === "retired" ? now : null,
  });
}

async function insertFixtureMailbox(
  db: TestDb,
  input: {
    id: string;
    address: string;
    status: "active" | "suspended" | "archived" | "deleted";
  },
) {
  const now = new Date().toISOString();
  await db.insert(schema.mailMailboxes).values({
    id: input.id,
    address: input.address,
    displayName: input.id,
    mailboxType: "shared",
    status: input.status,
    deletedAt: input.status === "deleted" ? now : null,
    createdBy: SEED_IDS.admin,
    createdAt: now,
    updatedAt: now,
  });
}

async function assertNoCanonicalArtifacts(db: TestDb) {
  const [messages, bodies, attachments, inboundMat, deliveryEvents, deliveryMat] =
    await Promise.all([
      db.select().from(schema.mailMessages),
      db.select().from(schema.mailMessageBodies),
      db.select().from(schema.mailMessageAttachments),
      db.select().from(schema.mailInboundMessageMaterializations),
      db.select().from(schema.mailDeliveryEvents),
      db.select().from(schema.mailDeliveryEventMaterializations),
    ]);
  assert.equal(messages.length, 0);
  assert.equal(bodies.length, 0);
  assert.equal(attachments.length, 0);
  assert.equal(inboundMat.length, 0);
  assert.equal(deliveryEvents.length, 0);
  assert.equal(deliveryMat.length, 0);
}

function logActiveResourceTypes(label: string): void {
  const diagnosticProcess = process as typeof process & {
    _getActiveHandles?: () => unknown[];
    _getActiveRequests?: () => unknown[];
  };
  const handles = diagnosticProcess._getActiveHandles?.() ?? [];
  const requests = diagnosticProcess._getActiveRequests?.() ?? [];
  const typeCounts = new Map<string, number>();
  for (const resource of handles) {
    const type =
      resource && typeof resource === "object" && "constructor" in resource
        ? String(
            (resource as { constructor?: { name?: string } }).constructor?.name ??
              "unknown",
          )
        : typeof resource;
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }
  console.error(
    `[mail-d1-diagnostics] ${label} handles=${JSON.stringify(
      Object.fromEntries(typeCounts),
    )} requests=${requests.length}`,
  );
}

describe("inbound provider staging", { concurrency: false }, () => {
describe("inbound provider staging Local D1", () => {
  let db: TestDb;
  let payloadStore: MemoryInboundRawPayloadStore;
  let dispose: (() => void) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    payloadStore = new MemoryInboundRawPayloadStore();
    await cleanupFixtures(db);
  });

  after(async () => {
    try {
      await cleanupFixtures(db);
    } finally {
      await dispose?.();
      logActiveResourceTypes("after-local-d1-dispose");
    }
  });

  it("direct: active address + active owner → pending with provenance", async () => {
    await cleanupFixtures(db);
    const mailbox = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("direct-mbox"),
      mailboxType: "shared",
    });
    const [primary] = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));
    assert.ok(primary);

    const mime = sampleMime();
    const result = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-direct-evt`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: mime,
      envelopeRecipients: [primary.address],
    });

    assert.equal(result.safeToAcknowledgeProvider, true);
    assert.equal(result.envelopeResults.length, 1);
    const envelope = result.envelopeResults[0]!;
    assert.equal(envelope.routeDecision, "direct");
    assert.equal(envelope.providerStatus, "pending");
    assert.equal(envelope.receivingAddressId, primary.id);
    assert.equal(envelope.routeOwnerMailboxId, mailbox.id);
    assert.equal(envelope.resolvedRouteMode, "direct");
    assert.equal(envelope.resolvedFallbackMailboxId, null);

    const [inboundChild] = await db
      .select()
      .from(schema.mailInboundIngestionEvents)
      .where(eq(schema.mailInboundIngestionEvents.ingestionEventId, envelope.ingestionEventId));
    assert.equal(inboundChild?.resolvedRouteMode, "direct");
    assert.equal(inboundChild?.resolvedFallbackMailboxId, null);

    const [providerRow] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, envelope.ingestionEventId));
    assert.equal(providerRow?.status, "pending");
    assert.equal(providerRow?.payloadContentHash, computeInboundPayloadContentHash(mime));

    const stored = await payloadStore.get(providerRow!.payloadStorageKey!);
    assert.ok(stored);
    assert.equal(Buffer.from(stored).compare(Buffer.from(mime)), 0);
    await assertNoCanonicalArtifacts(db);
  });

  it("unknown recipient → quarantined without provenance", async () => {
    await cleanupFixtures(db);
    const mime = sampleMime();
    const result = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-unknown-evt`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: mime,
      envelopeRecipients: [fixtureAddress("unknown")],
    });

    const envelope = result.envelopeResults[0]!;
    assert.equal(envelope.routeDecision, "quarantine");
    assert.equal(envelope.providerStatus, "quarantined");
    assert.equal(envelope.quarantineReason, INBOUND_QUARANTINE_REASONS.unknownReceivingAddress);
    assert.equal(envelope.receivingAddressId, null);
    assert.equal(envelope.resolvedRouteMode, null);
    assert.equal(envelope.resolvedFallbackMailboxId, null);
    assert.equal(result.safeToAcknowledgeProvider, true);
    await assertNoCanonicalArtifacts(db);
  });

  it("archived owner + valid fallback → pending with original owner preserved", async () => {
    await cleanupFixtures(db);
    const archivedId = `${FIXTURE}-archived-mbox`;
    const fallback = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("fallback"),
      mailboxType: "shared",
    });
    await setInboundFallbackMailbox(db, superAdminActor(), { mailboxId: fallback.id });

    await insertFixtureMailbox(db, {
      id: archivedId,
      address: fixtureAddress("archived-mbox-addr"),
      status: "archived",
    });
    const raAddress = fixtureAddress("archived-route");
    await insertReceivingAddress(db, {
      id: `${FIXTURE}-ra-archived`,
      mailboxId: archivedId,
      address: raAddress,
      status: "suspended",
    });

    const result = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-archived-evt`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: sampleMime(),
      envelopeRecipients: [raAddress],
    });

    const envelope = result.envelopeResults[0]!;
    assert.equal(envelope.routeDecision, "fallback");
    assert.equal(envelope.providerStatus, "pending");
    assert.equal(envelope.routeOwnerMailboxId, archivedId);
    assert.notEqual(envelope.routeOwnerMailboxId, fallback.id);
    assert.equal(envelope.resolvedRouteMode, "fallback");
    assert.equal(envelope.resolvedFallbackMailboxId, fallback.id);
    await assertNoCanonicalArtifacts(db);
  });

  it("fallback destination frozen at staging — config drift does not retarget", async () => {
    await cleanupFixtures(db);
    const archivedId = `${FIXTURE}-drift-archived`;
    const fallbackA = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("fallback-a"),
      mailboxType: "shared",
    });
    const fallbackB = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("fallback-b"),
      mailboxType: "shared",
    });
    await setInboundFallbackMailbox(db, superAdminActor(), {
      mailboxId: fallbackA.id,
    });

    await insertFixtureMailbox(db, {
      id: archivedId,
      address: fixtureAddress("drift-archived-addr"),
      status: "archived",
    });
    const raAddress = fixtureAddress("drift-route");
    await insertReceivingAddress(db, {
      id: `${FIXTURE}-ra-drift`,
      mailboxId: archivedId,
      address: raAddress,
      status: "suspended",
    });

    const staged = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-drift-evt`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: sampleMime(),
      envelopeRecipients: [raAddress],
    });
    const eventId = staged.envelopeResults[0]!.ingestionEventId;
    assert.equal(staged.envelopeResults[0]!.resolvedFallbackMailboxId, fallbackA.id);

    await setInboundFallbackMailbox(db, superAdminActor(), {
      mailboxId: fallbackB.id,
    });

    const [childAfterDrift] = await db
      .select()
      .from(schema.mailInboundIngestionEvents)
      .where(eq(schema.mailInboundIngestionEvents.ingestionEventId, eventId));
    assert.equal(childAfterDrift?.resolvedFallbackMailboxId, fallbackA.id);
    assert.notEqual(childAfterDrift?.resolvedFallbackMailboxId, fallbackB.id);

    const replay = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-drift-evt`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: sampleMime(),
      envelopeRecipients: [raAddress],
    });
    assert.equal(replay.envelopeResults[0]!.idempotentReplay, true);
    assert.equal(replay.envelopeResults[0]!.resolvedFallbackMailboxId, fallbackA.id);
    assert.equal(replay.safeToAcknowledgeProvider, true);
  });

  it("deleted owner + retired address + valid fallback → fallback with owner preserved", async () => {
    await cleanupFixtures(db);
    const deletedId = `${FIXTURE}-deleted-mbox`;
    const fallback = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("fallback-del"),
      mailboxType: "shared",
    });
    await setInboundFallbackMailbox(db, superAdminActor(), { mailboxId: fallback.id });

    await insertFixtureMailbox(db, {
      id: deletedId,
      address: fixtureAddress("deleted-mbox-addr"),
      status: "deleted",
    });
    const raAddress = fixtureAddress("deleted-route");
    await insertReceivingAddress(db, {
      id: `${FIXTURE}-ra-deleted`,
      mailboxId: deletedId,
      address: raAddress,
      status: "retired",
    });

    const envelope = (
      await stageInboundProviderEvent(db, payloadStore, {
        provider: PROVIDER,
        providerEventId: `${FIXTURE}-deleted-evt`,
        receivedAt: RECEIVED_AT,
        rawPayloadBytes: sampleMime(),
        envelopeRecipients: [raAddress],
      })
    ).envelopeResults[0]!;
    assert.equal(envelope.routeDecision, "fallback");
    assert.equal(envelope.routeOwnerMailboxId, deletedId);
    assert.equal(envelope.resolvedRouteMode, "fallback");
    assert.equal(envelope.resolvedFallbackMailboxId, fallback.id);
  });

  it("archived owner + missing fallback config → quarantined", async () => {
    await cleanupFixtures(db);
    const archivedId = `${FIXTURE}-archived-no-fb`;
    await insertFixtureMailbox(db, {
      id: archivedId,
      address: fixtureAddress("archived-no-fb-addr"),
      status: "archived",
    });
    const raAddress = fixtureAddress("archived-no-fb-route");
    await insertReceivingAddress(db, {
      id: `${FIXTURE}-ra-archived-no-fb`,
      mailboxId: archivedId,
      address: raAddress,
      status: "suspended",
    });

    const envelope = (
      await stageInboundProviderEvent(db, payloadStore, {
        provider: PROVIDER,
        providerEventId: `${FIXTURE}-archived-no-fb-evt`,
        receivedAt: RECEIVED_AT,
        rawPayloadBytes: sampleMime(),
        envelopeRecipients: [raAddress],
      })
    ).envelopeResults[0]!;
    assert.equal(envelope.routeDecision, "quarantine");
    assert.equal(envelope.quarantineReason, INBOUND_QUARANTINE_REASONS.fallbackNotConfigured);
    assert.equal(envelope.providerStatus, "quarantined");
    assert.equal(envelope.resolvedRouteMode, null);
    assert.equal(envelope.resolvedFallbackMailboxId, null);
  });

  it("direct route ignores company fallback config", async () => {
    await cleanupFixtures(db);
    const directMailbox = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("direct-ignore-fb"),
      mailboxType: "shared",
    });
    const fallback = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("company-fallback"),
      mailboxType: "shared",
    });
    await setInboundFallbackMailbox(db, superAdminActor(), {
      mailboxId: fallback.id,
    });
    const [ra] = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, directMailbox.id));

    const result = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-direct-ignore-fb`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: sampleMime(),
      envelopeRecipients: [ra!.address],
    });
    const envelope = result.envelopeResults[0]!;
    assert.equal(envelope.routeDecision, "direct");
    assert.equal(envelope.routeOwnerMailboxId, directMailbox.id);
    assert.equal(envelope.resolvedRouteMode, "direct");
    assert.equal(envelope.resolvedFallbackMailboxId, null);
  });

  it("suspended owner and suspended address paths quarantine", async () => {
    await cleanupFixtures(db);
    const suspendedOwnerId = `${FIXTURE}-suspended-owner`;
    await insertFixtureMailbox(db, {
      id: suspendedOwnerId,
      address: fixtureAddress("suspended-owner-addr"),
      status: "suspended",
    });
    const ownerRoute = fixtureAddress("suspended-owner-route");
    await insertReceivingAddress(db, {
      id: `${FIXTURE}-ra-suspended-owner`,
      mailboxId: suspendedOwnerId,
      address: ownerRoute,
      status: "active",
    });

    const activeOwnerId = `${FIXTURE}-active-owner`;
    await insertFixtureMailbox(db, {
      id: activeOwnerId,
      address: fixtureAddress("active-owner-addr"),
      status: "active",
    });
    const suspendedAddr = fixtureAddress("suspended-address-route");
    await insertReceivingAddress(db, {
      id: `${FIXTURE}-ra-suspended-address`,
      mailboxId: activeOwnerId,
      address: suspendedAddr,
      status: "suspended",
    });

    const ownerResult = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-suspended-owner-evt`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: sampleMime(),
      envelopeRecipients: [ownerRoute],
    });
    assert.equal(ownerResult.envelopeResults[0]!.routeDecision, "quarantine");
    assert.equal(
      ownerResult.envelopeResults[0]!.quarantineReason,
      INBOUND_QUARANTINE_REASONS.routeOwnerSuspended,
    );

    const addrResult = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-suspended-address-evt`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: sampleMime(),
      envelopeRecipients: [suspendedAddr],
    });
    assert.equal(addrResult.envelopeResults[0]!.routeDecision, "quarantine");
    assert.equal(
      addrResult.envelopeResults[0]!.quarantineReason,
      INBOUND_QUARANTINE_REASONS.receivingAddressSuspended,
    );
  });

  it("multi-recipient fans out to separate provider events with mixed outcomes", async () => {
    await cleanupFixtures(db);
    const directMailbox = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("multi-direct-mbox"),
      mailboxType: "shared",
    });
    const [directRa] = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, directMailbox.id));

    const mime = sampleMime();
    const result = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-multi-evt`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: mime,
      envelopeRecipients: [directRa!.address, fixtureAddress("multi-unknown")],
    });

    assert.equal(result.envelopeResults.length, 2);
    assert.equal(result.safeToAcknowledgeProvider, true);

    const providerRows = await db.select().from(schema.mailProviderIngestionEvents);
    assert.equal(providerRows.length, 2);

    const direct = result.envelopeResults.find((row) => row.routeDecision === "direct");
    const unknown = result.envelopeResults.find((row) => row.routeDecision === "quarantine");
    assert.ok(direct);
    assert.ok(unknown);
    assert.notEqual(direct.ingestionEventId, unknown.ingestionEventId);
    assert.equal(
      providerRows[0]?.payloadStorageKey,
      providerRows[1]?.payloadStorageKey,
    );
  });

  it("provider event idempotency replays without duplicate rows", async () => {
    await cleanupFixtures(db);
    const mailbox = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("idempotent-mbox"),
      mailboxType: "shared",
    });
    const [ra] = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));

    const input = {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-idempotent-evt`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: sampleMime(),
      envelopeRecipients: [ra!.address],
    };

    const first = await stageInboundProviderEvent(db, payloadStore, input);
    const second = await stageInboundProviderEvent(db, payloadStore, input);
    assert.equal(second.envelopeResults[0]!.idempotentReplay, true);
    assert.equal(
      first.envelopeResults[0]!.ingestionEventId,
      second.envelopeResults[0]!.ingestionEventId,
    );

    const rows = await db.select().from(schema.mailProviderIngestionEvents);
    assert.equal(rows.length, 1);
  });

  it("dedupe collision with different payload hash is not accepted", async () => {
    await cleanupFixtures(db);
    const mailbox = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("collision-mbox"),
      mailboxType: "shared",
    });
    const [ra] = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));

    const base = {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-collision-evt`,
      receivedAt: RECEIVED_AT,
      envelopeRecipients: [ra!.address],
    };
    await stageInboundProviderEvent(db, payloadStore, {
      ...base,
      rawPayloadBytes: sampleMime(),
    });

    const collision = await stageInboundProviderEvent(db, payloadStore, {
      ...base,
      rawPayloadBytes: new TextEncoder().encode("different mime bytes"),
    });
    assert.equal(collision.safeToAcknowledgeProvider, false);
    assert.equal(collision.envelopeResults[0]!.quarantineReason, INBOUND_QUARANTINE_REASONS.integrityConflict);
    assert.equal(
      (await db.select().from(schema.mailProviderIngestionEvents)).length,
      1,
    );
  });

  it("storage failure → safeToAcknowledgeProvider false and no D1 rows", async () => {
    await cleanupFixtures(db);
    const failingStore = new FailingInboundRawPayloadStore();
    const result = await stageInboundProviderEvent(db, failingStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-storage-fail`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: sampleMime(),
      envelopeRecipients: [fixtureAddress("any")],
    });
    assert.equal(result.safeToAcknowledgeProvider, false);
    assert.equal(result.durablyStaged, false);
    const rows = await db.select().from(schema.mailProviderIngestionEvents);
    assert.equal(rows.length, 0);
  });

  it("D1 failure after raw write → safeToAcknowledgeProvider false", async () => {
    await cleanupFixtures(db);
    const mailbox = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("d1-fail-mbox"),
      mailboxType: "shared",
    });
    const [ra] = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));

    const result = await stageInboundProviderEventWithBatchFailure(
      db,
      payloadStore,
      {
        provider: PROVIDER,
        providerEventId: `${FIXTURE}-d1-fail-evt`,
        receivedAt: RECEIVED_AT,
        rawPayloadBytes: sampleMime(),
        envelopeRecipients: [ra!.address],
      },
      async () => {
        throw new Error("Simulated D1 batch failure");
      },
    );
    assert.equal(result.safeToAcknowledgeProvider, false);
    assert.equal(result.durablyStaged, false);
    const rows = await db.select().from(schema.mailProviderIngestionEvents);
    assert.equal(rows.length, 0);
  });

  it("creates staging audit without raw mime content", async () => {
    await cleanupFixtures(db);
    const mailbox = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("audit-mbox"),
      mailboxType: "shared",
    });
    const [ra] = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));

    await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-audit-evt`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: sampleMime(),
      envelopeRecipients: [ra!.address],
    });

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, MAIL_AUDIT_ACTIONS.inboundProviderStaged));
    assert.equal(audits.length, 1);
    const meta = JSON.parse(audits[0]?.metadata ?? "{}") as Record<string, unknown>;
    assert.equal(meta.provider, PROVIDER);
    assert.ok(typeof meta.payloadHashPrefix === "string");
    assert.equal(JSON.stringify(meta).includes("From:"), false);
  });
});
describe("inbound provider staging Local R2", () => {
  it("byte-for-byte replay from ATTACHMENTS binding", async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    let dispose: (() => void | Promise<void>) | undefined;
    try {
      const proxy = await getTestD1PlatformProxy<{
        DB: unknown;
        ATTACHMENTS: import("@/lib/mail/inbound-raw-payload-store").InboundRawPayloadBucket;
      }>({
        configPath: "wrangler.jsonc",
      });
      dispose = proxy.dispose;
      const db = drizzle(proxy.env.DB, { schema });
      bindTestDatabase(db);
      const r2Store = createInboundRawPayloadStore(proxy.env.ATTACHMENTS);
      await cleanupFixtures(db);

      const mailbox = await createMailbox(db, superAdminActor(), {
        address: fixtureAddress("r2-mbox"),
        mailboxType: "shared",
      });
      const [ra] = await db
        .select()
        .from(schema.mailReceivingAddresses)
        .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));

      const mime = sampleMime();
      const staged = await stageInboundProviderEvent(db, r2Store, {
        provider: PROVIDER,
        providerEventId: `${FIXTURE}-r2-evt`,
        receivedAt: RECEIVED_AT,
        rawPayloadBytes: mime,
        envelopeRecipients: [ra!.address],
      });
      assert.equal(staged.safeToAcknowledgeProvider, true);

      const [providerRow] = await db
        .select()
        .from(schema.mailProviderIngestionEvents)
        .where(
          eq(
            schema.mailProviderIngestionEvents.id,
            staged.envelopeResults[0]!.ingestionEventId,
          ),
        );
      const read = await r2Store.get(providerRow!.payloadStorageKey!);
      assert.ok(read);
      assert.equal(Buffer.from(read).compare(Buffer.from(mime)), 0);
      assert.equal(
        computeInboundPayloadContentHash(read),
        providerRow!.payloadContentHash,
      );

      await cleanupFixtures(db);
    } finally {
      await dispose?.();
      logActiveResourceTypes("after-local-r2-dispose");
    }
  });
});
});
