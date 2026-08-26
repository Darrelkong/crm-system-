import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_ERROR_CODES } from "@/lib/mail/constants";
import { computeInboundPayloadContentHash } from "@/lib/mail/inbound-payload-hash";
import { INBOUND_QUARANTINE_REASONS } from "@/lib/mail/inbound-quarantine-reasons";
import {
  COMPLETED_RAW_MIME_RETENTION_DAYS,
  QUARANTINED_RAW_MIME_RETENTION_DAYS,
  subtractRetentionDays,
} from "@/lib/mail/inbound-raw-mime-retention";
import {
  listEligibleInboundRawMimePurgeEvents,
  purgeInboundRawMimeForEvent,
  runInboundRawMimeRetentionCleanup,
} from "@/lib/mail/inbound-raw-mime-retention-service";
import { MemoryInboundAttachmentStore } from "@/lib/mail/inbound-attachment-store";
import { materializeInboundIngestionEvent } from "@/lib/mail/inbound-message-materialization-service";
import {
  FailingInboundRawPayloadStore,
  INBOUND_RAW_PAYLOAD_KEY_PREFIX,
  MemoryInboundRawPayloadStore,
} from "@/lib/mail/inbound-raw-payload-store";
import { replayQuarantinedIngestionEvent } from "@/lib/mail/ingestion-quarantine-replay-service";
import { stageInboundProviderEvent } from "@/lib/mail/inbound-provider-staging-service";
import { createMailbox } from "@/lib/mail/mailbox-service";

const FIXTURE = "mail-phase6m5-retention";
const PROVIDER = "fixture-provider";
const TRUST_NOW = "2026-08-27T00:00:00.000Z";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function adminActor(): MailActorContext {
  return {
    userId: SEED_IDS.admin,
    sessionId: null,
    crmRole: "admin",
    mailAccessEnabled: true,
    adminGrants: ["super_admin", "delivery_health"],
    audit: { ipAddress: "127.0.0.1", userAgent: "phase6m5-retention" },
  };
}

function fixtureAddress(localPart: string): string {
  return `${FIXTURE}-${localPart}@echfronthk.com`;
}

function sampleMime(messageId: string): Uint8Array {
  return new TextEncoder().encode(
    `From: sender@external.test\r\nTo: ignored@example.com\r\nSubject: retention\r\nMessage-ID: ${messageId}\r\n\r\nbody`,
  );
}

async function cleanupFixtures(db: TestDb) {
  const fixtureProviders = await db
    .select({ id: schema.mailProviderIngestionEvents.id })
    .from(schema.mailProviderIngestionEvents)
    .where(like(schema.mailProviderIngestionEvents.ingestionDedupeKey, `${FIXTURE}:%`));

  for (const { id } of fixtureProviders) {
    const materializations = await db
      .select({
        mailMessageId: schema.mailInboundMessageMaterializations.mailMessageId,
      })
      .from(schema.mailInboundMessageMaterializations)
      .where(eq(schema.mailInboundMessageMaterializations.ingestionEventId, id));

    for (const { mailMessageId } of materializations) {
      if (!mailMessageId) continue;
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
        .where(eq(schema.mailInboundMessageMaterializations.ingestionEventId, id));
      await db
        .delete(schema.mailMessages)
        .where(eq(schema.mailMessages.id, mailMessageId));
    }

    await db
      .delete(schema.mailInboundIngestionEvents)
      .where(eq(schema.mailInboundIngestionEvents.ingestionEventId, id));
    await db
      .delete(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, id));
  }

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
    await db
      .delete(schema.mailThreads)
      .where(eq(schema.mailThreads.mailboxId, id));
  }
  await db
    .delete(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.address, `${FIXTURE}%`));
}

async function insertTerminalProviderEvent(
  db: TestDb,
  input: {
    id: string;
    status: "completed" | "quarantined" | "pending" | "processing";
    ageDays?: number;
    payloadStorageKey: string | null;
  },
) {
  const mime = sampleMime(`<${input.id}@external.test>`);
  const hash = computeInboundPayloadContentHash(mime);
  let finalizedAt: string | null = null;
  let quarantineReason: string | null = null;

  if (input.status === "completed") {
    finalizedAt = subtractRetentionDays(
      TRUST_NOW,
      input.ageDays ?? COMPLETED_RAW_MIME_RETENTION_DAYS,
    );
  } else if (input.status === "quarantined") {
    finalizedAt = subtractRetentionDays(
      TRUST_NOW,
      input.ageDays ?? QUARANTINED_RAW_MIME_RETENTION_DAYS,
    );
    quarantineReason = INBOUND_QUARANTINE_REASONS.integrityConflict;
  }

  await db.insert(schema.mailProviderIngestionEvents).values({
    id: input.id,
    eventKind: "inbound_message",
    provider: PROVIDER,
    ingestionDedupeKey: `${FIXTURE}:${input.id}`,
    status: input.status,
    processingVersion: 1,
    receivedAt: finalizedAt ?? subtractRetentionDays(TRUST_NOW, 365),
    finalizedAt,
    quarantineReason,
    payloadStorageProvider: input.payloadStorageKey ? "r2" : null,
    payloadStorageKey: input.payloadStorageKey,
    payloadContentHash: input.payloadStorageKey ? hash : null,
    payloadSizeBytes: input.payloadStorageKey ? mime.byteLength : null,
  });
}

describe("inbound raw mime retention integration", () => {
  let db: TestDb;
  let payloadStore: MemoryInboundRawPayloadStore;
  let dispose: (() => void) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    try {
      const proxy = await getPlatformProxy<{ DB: unknown }>({
        configPath: "wrangler.jsonc",
      });
      db = drizzle(proxy.env.DB, { schema });
      bindTestDatabase(db);
      dispose = proxy.dispose;
      payloadStore = new MemoryInboundRawPayloadStore();
      await cleanupFixtures(db);
    } catch (error) {
      throw new Error(
        `retention integration setup failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  });

  after(async () => {
    await cleanupFixtures(db);
    dispose?.();
  });

  it("keeps completed raw MIME younger than 14 days", async () => {
    const put = await payloadStore.put(sampleMime("<young@external.test>"));
    await insertTerminalProviderEvent(db, {
      id: `${FIXTURE}-young-completed`,
      status: "completed",
      ageDays: 13,
      payloadStorageKey: put.storageKey,
    });

    const eligible = await listEligibleInboundRawMimePurgeEvents(db, {
      trustNow: TRUST_NOW,
      limit: 10,
    });
    assert.equal(
      eligible.some((row) => row.id === `${FIXTURE}-young-completed`),
      false,
    );
    assert.ok(await payloadStore.exists(put.storageKey));
  });

  it("purges completed raw MIME at 14+ days and nulls payload key", async () => {
    const put = await payloadStore.put(sampleMime("<old-completed@external.test>"));
    const eventId = `${FIXTURE}-old-completed`;
    await insertTerminalProviderEvent(db, {
      id: eventId,
      status: "completed",
      ageDays: COMPLETED_RAW_MIME_RETENTION_DAYS + 1,
      payloadStorageKey: put.storageKey,
    });

    const counters = await runInboundRawMimeRetentionCleanup(db, payloadStore, {
      trustNow: TRUST_NOW,
      limit: 10,
    });
    assert.equal(counters.purged, 1);
    assert.equal(await payloadStore.exists(put.storageKey), false);

    const [row] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, eventId));
    assert.equal(row?.payloadStorageKey, null);
  });

  it("keeps quarantined raw MIME younger than 60 days", async () => {
    const put = await payloadStore.put(sampleMime("<young-q@external.test>"));
    await insertTerminalProviderEvent(db, {
      id: `${FIXTURE}-young-quarantined`,
      status: "quarantined",
      ageDays: 59,
      payloadStorageKey: put.storageKey,
    });

    const eligible = await listEligibleInboundRawMimePurgeEvents(db, {
      trustNow: TRUST_NOW,
      limit: 20,
    });
    assert.equal(
      eligible.some((row) => row.id === `${FIXTURE}-young-quarantined`),
      false,
    );
    assert.ok(await payloadStore.exists(put.storageKey));
  });

  it("purges quarantined raw MIME at 60+ days", async () => {
    const put = await payloadStore.put(sampleMime("<old-q@external.test>"));
    const eventId = `${FIXTURE}-old-quarantined`;
    await insertTerminalProviderEvent(db, {
      id: eventId,
      status: "quarantined",
      ageDays: QUARANTINED_RAW_MIME_RETENTION_DAYS + 1,
      payloadStorageKey: put.storageKey,
    });

    const outcome = await purgeInboundRawMimeForEvent(db, payloadStore, {
      id: eventId,
      payloadStorageKey: put.storageKey,
      status: "quarantined",
    });
    assert.equal(outcome, "purged");
    assert.equal(await payloadStore.get(put.storageKey), null);
  });

  it("keeps pending and processing events regardless of age", async () => {
    const putPending = await payloadStore.put(sampleMime("<pending@external.test>"));
    const putProcessing = await payloadStore.put(
      sampleMime("<processing@external.test>"),
    );
    await insertTerminalProviderEvent(db, {
      id: `${FIXTURE}-pending-old`,
      status: "pending",
      payloadStorageKey: putPending.storageKey,
    });
    await insertTerminalProviderEvent(db, {
      id: `${FIXTURE}-processing-old`,
      status: "processing",
      payloadStorageKey: putProcessing.storageKey,
    });

    const counters = await runInboundRawMimeRetentionCleanup(db, payloadStore, {
      trustNow: TRUST_NOW,
      limit: 20,
    });
    assert.equal(counters.purged, 0);
    assert.ok(await payloadStore.exists(putPending.storageKey));
    assert.ok(await payloadStore.exists(putProcessing.storageKey));
  });

  it("reconciles idempotently when R2 object is already missing", async () => {
    const key = `${INBOUND_RAW_PAYLOAD_KEY_PREFIX}missing-${FIXTURE}`;
    const eventId = `${FIXTURE}-already-missing`;
    await insertTerminalProviderEvent(db, {
      id: eventId,
      status: "completed",
      ageDays: COMPLETED_RAW_MIME_RETENTION_DAYS + 1,
      payloadStorageKey: key,
    });

    const outcome = await purgeInboundRawMimeForEvent(db, payloadStore, {
      id: eventId,
      payloadStorageKey: key,
      status: "completed",
    });
    assert.equal(outcome, "already_missing");

    const repeat = await purgeInboundRawMimeForEvent(db, payloadStore, {
      id: eventId,
      payloadStorageKey: key,
      status: "completed",
    });
    assert.equal(repeat, "skipped");
  });

  it("preserves D1 key when delete fails", async () => {
    const base = new MemoryInboundRawPayloadStore();
    const put = await base.put(sampleMime("<fail-delete@external.test>"));
    const failingStore = {
      put: (bytes: Uint8Array) => base.put(bytes),
      get: (key: string) => base.get(key),
      exists: (key: string) => base.exists(key),
      delete: async () => {
        throw new Error("delete failed");
      },
    };
    const eventId = `${FIXTURE}-delete-fail`;
    await insertTerminalProviderEvent(db, {
      id: eventId,
      status: "completed",
      ageDays: COMPLETED_RAW_MIME_RETENTION_DAYS + 1,
      payloadStorageKey: put.storageKey,
    });

    const outcome = await purgeInboundRawMimeForEvent(db, failingStore, {
      id: eventId,
      payloadStorageKey: put.storageKey,
      status: "completed",
    });
    assert.equal(outcome, "error");

    const [row] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, eventId));
    assert.equal(row?.payloadStorageKey, put.storageKey);
  });

  it("preserves canonical mail message, thread, and attachment after raw purge", async () => {
    const address = fixtureAddress("canonical");
    const mailbox = await createMailbox(db, adminActor(), {
      address,
      displayName: "Retention Mailbox",
      mailboxType: "personal",
      ownerUserId: SEED_IDS.staffA,
    });
    const [primary] = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));

    const mime = sampleMime("<canonical@external.test>");
    const staged = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-canonical-provider`,
      receivedAt: TRUST_NOW,
      rawPayloadBytes: mime,
      envelopeRecipients: [primary!.address],
    });
    const ingestionEventId = staged.envelopeResults[0]!.ingestionEventId;

    await materializeInboundIngestionEvent(
      db,
      {
        rawPayloadStore: payloadStore,
        attachmentStore: new MemoryInboundAttachmentStore(),
      },
      { ingestionEventId },
    );

    const finalizedAt = subtractRetentionDays(
      TRUST_NOW,
      COMPLETED_RAW_MIME_RETENTION_DAYS + 1,
    );
    await db
      .update(schema.mailProviderIngestionEvents)
      .set({ finalizedAt })
      .where(eq(schema.mailProviderIngestionEvents.id, ingestionEventId));

    const [beforeMessage] = await db.select().from(schema.mailMessages);
    assert.ok(beforeMessage);

    const counters = await runInboundRawMimeRetentionCleanup(db, payloadStore, {
      trustNow: TRUST_NOW,
      limit: 10,
    });
    assert.equal(counters.purged, 1);

    const [afterMessage] = await db
      .select()
      .from(schema.mailMessages)
      .where(eq(schema.mailMessages.id, beforeMessage!.id));
    assert.ok(afterMessage);
    assert.equal(afterMessage?.threadId, beforeMessage?.threadId);

    const [providerRow] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, ingestionEventId));
    assert.equal(providerRow?.payloadStorageKey, null);
    assert.equal(providerRow?.payloadContentHash, null);
    assert.equal(providerRow?.status, "completed");
  });

  it("refuses replay when raw payload was purged", async () => {
    const address = fixtureAddress("replay-expired");
    const mailbox = await createMailbox(db, adminActor(), {
      address,
      displayName: "Replay Mailbox",
      mailboxType: "personal",
      ownerUserId: SEED_IDS.staffA,
    });
    const [primary] = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));

    const mime = sampleMime("<replay-expired@external.test>");
    const staged = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-replay-provider`,
      receivedAt: TRUST_NOW,
      rawPayloadBytes: mime,
      envelopeRecipients: [primary!.address],
    });
    const ingestionEventId = staged.envelopeResults[0]!.ingestionEventId;

    await db
      .update(schema.mailProviderIngestionEvents)
      .set({
        status: "quarantined",
        quarantineReason: INBOUND_QUARANTINE_REASONS.unknownReceivingAddress,
        finalizedAt: subtractRetentionDays(TRUST_NOW, QUARANTINED_RAW_MIME_RETENTION_DAYS),
      })
      .where(eq(schema.mailProviderIngestionEvents.id, ingestionEventId));

    const [providerBefore] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, ingestionEventId));
    assert.ok(providerBefore?.payloadStorageKey);

    await purgeInboundRawMimeForEvent(db, payloadStore, {
      id: ingestionEventId,
      payloadStorageKey: providerBefore!.payloadStorageKey!,
      status: "quarantined",
    });

    const replay = await replayQuarantinedIngestionEvent(db, adminActor(), {
      ingestionEventId,
    });
    assert.equal(replay.outcome, "REPLAY_REFUSED");
    assert.match(replay.message ?? "", /not available/i);
  });
});

describe("materialize inbound after raw purge", () => {
  it("returns RAW_PAYLOAD_NOT_AVAILABLE when payload key is null", async () => {
    const providerEvent = {
      payloadStorageKey: null,
      payloadContentHash: "abc",
      payloadSizeBytes: 1,
    };
    const { MailServiceError } = await import("@/lib/mail/errors");
    assert.throws(
      () => {
        if (
          !providerEvent.payloadStorageKey ||
          !providerEvent.payloadContentHash ||
          providerEvent.payloadSizeBytes == null
        ) {
          throw MailServiceError.rawPayloadNotAvailable();
        }
      },
      (error: unknown) =>
        error instanceof MailServiceError &&
        error.errorCode === MAIL_ERROR_CODES.RAW_PAYLOAD_NOT_AVAILABLE,
    );
  });
});
