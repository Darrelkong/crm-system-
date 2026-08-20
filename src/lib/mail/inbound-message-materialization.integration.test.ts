import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MemoryInboundAttachmentStore } from "@/lib/mail/inbound-attachment-store";
import { materializeInboundIngestionEvent } from "@/lib/mail/inbound-message-materialization-service";
import { computeInboundPayloadContentHash } from "@/lib/mail/inbound-payload-hash";
import { INBOUND_QUARANTINE_REASONS } from "@/lib/mail/inbound-quarantine-reasons";
import {
  MemoryInboundRawPayloadStore,
} from "@/lib/mail/inbound-raw-payload-store";
import { stageInboundProviderEvent } from "@/lib/mail/inbound-provider-staging-service";
import { setInboundFallbackMailbox } from "@/lib/mail/inbound-fallback-config-service";
import { createMailbox } from "@/lib/mail/mailbox-service";

const FIXTURE = "mail-phase2c10";
const PROVIDER = "fixture-provider";
const RECEIVED_AT = "2026-08-20T20:00:00.000Z";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function superAdminActor(): MailActorContext {
  return {
    userId: SEED_IDS.admin,
    sessionId: null,
    crmRole: "admin",
    mailAccessEnabled: true,
    adminGrants: ["super_admin"],
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2c10-test" },
  };
}

function fixtureAddress(localPart: string): string {
  return `${FIXTURE}-${localPart}@echfronthk.com`;
}

function encodeMime(raw: string): Uint8Array {
  return new TextEncoder().encode(raw);
}

function buildMime(input: {
  from?: string;
  to?: string;
  subject?: string;
  messageId?: string | null;
  body?: string;
  html?: string;
  attachment?: { filename: string; content: string; inline?: boolean };
}): Uint8Array {
  const lines: string[] = [
    `From: ${input.from ?? "Sender <sender@external.test>"}`,
    `To: ${input.to ?? "Visible <visible@example.com>"}`,
    `Subject: ${input.subject ?? "Inbound test"}`,
  ];
  if (input.messageId) {
    lines.push(`Message-ID: ${input.messageId}`);
  }
  lines.push("MIME-Version: 1.0");

  if (input.attachment) {
    const boundary = "phase2c10b";
    lines.push(`Content-Type: multipart/mixed; boundary=${boundary}`);
    lines.push("");
    lines.push(`--${boundary}`);
    lines.push("Content-Type: text/plain; charset=utf-8");
    lines.push("");
    lines.push(input.body ?? "Body with attachment");
    lines.push(`--${boundary}`);
    const disposition = input.attachment.inline
      ? "inline"
      : "attachment";
    lines.push(
      `Content-Type: application/octet-stream; name="${input.attachment.filename}"`,
    );
    lines.push(`Content-Disposition: ${disposition}; filename="${input.attachment.filename}"`);
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(Buffer.from(input.attachment.content).toString("base64"));
    lines.push(`--${boundary}--`);
  } else if (input.html) {
    lines.push("Content-Type: text/html; charset=utf-8");
    lines.push("");
    lines.push(input.html);
  } else {
    lines.push("Content-Type: text/plain; charset=utf-8");
    lines.push("");
    lines.push(input.body ?? "Plain body");
  }

  return encodeMime(lines.join("\r\n"));
}

async function cleanupFixtures(db: TestDb) {
  await db
    .delete(schema.auditLogs)
    .where(like(schema.auditLogs.action, "mail.inbound.%"));

  const fixtureMessages = await db
    .select({ id: schema.mailMessages.id })
    .from(schema.mailMessages)
    .where(like(schema.mailMessages.id, `${FIXTURE}%`));
  const fixtureMessageIds = fixtureMessages.map((row) => row.id);

  if (fixtureMessageIds.length > 0) {
    for (const messageId of fixtureMessageIds) {
      await db
        .delete(schema.mailInboundMessageMaterializations)
        .where(eq(schema.mailInboundMessageMaterializations.mailMessageId, messageId));
      await db
        .delete(schema.mailMessageAttachments)
        .where(eq(schema.mailMessageAttachments.messageId, messageId));
      await db
        .delete(schema.mailMessageBodies)
        .where(eq(schema.mailMessageBodies.messageId, messageId));
      await db
        .delete(schema.mailMessageRecipients)
        .where(eq(schema.mailMessageRecipients.messageId, messageId));
      await db
        .delete(schema.mailMessages)
        .where(eq(schema.mailMessages.id, messageId));
    }
  }

  await db
    .delete(schema.mailInboundMessageMaterializations)
    .where(like(schema.mailInboundMessageMaterializations.id, `${FIXTURE}%`));

  const fixtureProviders = await db
    .select({ id: schema.mailProviderIngestionEvents.id })
    .from(schema.mailProviderIngestionEvents)
    .where(like(schema.mailProviderIngestionEvents.providerEventId, `${FIXTURE}%`));
  for (const { id } of fixtureProviders) {
    const materializations = await db
      .select({ mailMessageId: schema.mailInboundMessageMaterializations.mailMessageId })
      .from(schema.mailInboundMessageMaterializations)
      .where(eq(schema.mailInboundMessageMaterializations.ingestionEventId, id));
    for (const { mailMessageId } of materializations) {
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
        .where(eq(schema.mailMessages.id, mailMessageId))
        .limit(1);
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
      .delete(schema.mailInboundMessageMaterializations)
      .where(eq(schema.mailInboundMessageMaterializations.ingestionEventId, id));
    await db
      .delete(schema.mailInboundIngestionEvents)
      .where(eq(schema.mailInboundIngestionEvents.ingestionEventId, id));
    await db
      .delete(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, id));
  }
  await db
    .delete(schema.mailStoredFiles)
    .where(like(schema.mailStoredFiles.id, `${FIXTURE}%`));
  await db
    .delete(schema.mailThreads)
    .where(like(schema.mailThreads.id, `${FIXTURE}%`));
  await db.delete(schema.mailCompanyConfig);

  const mailboxes = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.address, `${FIXTURE}%`));
  for (const { id } of mailboxes) {
    const mailboxMessages = await db
      .select({ id: schema.mailMessages.id, threadId: schema.mailMessages.threadId })
      .from(schema.mailMessages)
      .where(eq(schema.mailMessages.mailboxId, id));
    for (const message of mailboxMessages) {
      await db
        .delete(schema.mailMessageAttachments)
        .where(eq(schema.mailMessageAttachments.messageId, message.id));
      await db
        .delete(schema.mailMessageBodies)
        .where(eq(schema.mailMessageBodies.messageId, message.id));
      await db
        .delete(schema.mailMessageRecipients)
        .where(eq(schema.mailMessageRecipients.messageId, message.id));
      await db
        .delete(schema.mailInboundMessageMaterializations)
        .where(eq(schema.mailInboundMessageMaterializations.mailMessageId, message.id));
      await db
        .delete(schema.mailMessages)
        .where(eq(schema.mailMessages.id, message.id));
    }
    await db
      .delete(schema.mailInboundMessageMaterializations)
      .where(eq(schema.mailInboundMessageMaterializations.materializedMailboxId, id));
    await db
      .delete(schema.mailThreads)
      .where(eq(schema.mailThreads.mailboxId, id));
    await db
      .delete(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, id));
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
  },
) {
  const now = new Date().toISOString();
  await db.insert(schema.mailReceivingAddresses).values({
    id: input.id,
    mailboxId: input.mailboxId,
    address: input.address,
    addressType: "primary",
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

async function stagePendingDirect(
  db: TestDb,
  payloadStore: MemoryInboundRawPayloadStore,
  input: {
    providerEventId: string;
    mime: Uint8Array;
    recipientAddress: string;
  },
) {
  const staged = await stageInboundProviderEvent(db, payloadStore, {
    provider: PROVIDER,
    providerEventId: input.providerEventId,
    receivedAt: RECEIVED_AT,
    rawPayloadBytes: input.mime,
    envelopeRecipients: [input.recipientAddress],
  });
  const envelope = staged.envelopeResults[0]!;
  assert.equal(envelope.providerStatus, "pending");
  return envelope;
}

describe("inbound message materialization Local D1/R2", () => {
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
  });

  after(async () => {
    await cleanupFixtures(db);
    dispose?.();
  });

  it("materializes direct pending ingestion into canonical inbound graph", async () => {
    await cleanupFixtures(db);
    const mailbox = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("direct"),
      mailboxType: "shared",
    });
    const [primary] = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));
    assert.ok(primary);

    const mime = buildMime({
      messageId: "<direct-materialize@external.test>",
      subject: "Direct materialize",
      body: "Hello inbox",
    });
    const staged = await stagePendingDirect(db, payloadStore, {
      providerEventId: `${FIXTURE}-direct-mat`,
      mime,
      recipientAddress: primary.address,
    });

    const result = await materializeInboundIngestionEvent(
      db,
      { rawPayloadStore: payloadStore, attachmentStore },
      { ingestionEventId: staged.ingestionEventId, expectedProcessingVersion: 1 },
    );

    assert.equal(result.message.direction, "inbound");
    assert.equal(result.message.mailboxId, mailbox.id);
    assert.equal(result.message.internetMessageId, "<direct-materialize@external.test>");
    assert.equal(result.convergedExistingMessage, false);

    const [provider] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, staged.ingestionEventId));
    assert.equal(provider?.status, "completed");
    assert.ok(provider?.finalizedAt);

    const [audit] = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, MAIL_AUDIT_ACTIONS.inboundMaterialized));
    assert.ok(audit);
  });

  it("idempotent materialization returns same canonical result", async () => {
    await cleanupFixtures(db);
    const mailbox = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("idem"),
      mailboxType: "shared",
    });
    const [primary] = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));
    const mime = buildMime({ messageId: "<idem@external.test>" });
    const staged = await stagePendingDirect(db, payloadStore, {
      providerEventId: `${FIXTURE}-idem`,
      mime,
      recipientAddress: primary!.address,
    });

    const first = await materializeInboundIngestionEvent(
      db,
      { rawPayloadStore: payloadStore, attachmentStore },
      { ingestionEventId: staged.ingestionEventId },
    );
    const second = await materializeInboundIngestionEvent(
      db,
      { rawPayloadStore: payloadStore, attachmentStore },
      { ingestionEventId: staged.ingestionEventId },
    );
    assert.equal(first.message.id, second.message.id);
    assert.equal(first.materialization.id, second.materialization.id);
  });

  it("NULL Message-ID distinct events create distinct canonical messages", async () => {
    await cleanupFixtures(db);
    const mailbox = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("null-id"),
      mailboxType: "shared",
    });
    const [primary] = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));
    const mime = buildMime({ messageId: null, body: "Same body" });

    const first = await stagePendingDirect(db, payloadStore, {
      providerEventId: `${FIXTURE}-null-a`,
      mime,
      recipientAddress: primary!.address,
    });
    const second = await stagePendingDirect(db, payloadStore, {
      providerEventId: `${FIXTURE}-null-b`,
      mime,
      recipientAddress: primary!.address,
    });

    const matA = await materializeInboundIngestionEvent(
      db,
      { rawPayloadStore: payloadStore, attachmentStore },
      { ingestionEventId: first.ingestionEventId },
    );
    const matB = await materializeInboundIngestionEvent(
      db,
      { rawPayloadStore: payloadStore, attachmentStore },
      { ingestionEventId: second.ingestionEventId },
    );
    assert.notEqual(matA.message.id, matB.message.id);
    assert.equal(matA.message.internetMessageId, null);
    assert.equal(matB.message.internetMessageId, null);
  });

  it("RFC exact replay converges to one canonical message with two provenance rows", async () => {
    await cleanupFixtures(db);
    const mailbox = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("replay"),
      mailboxType: "shared",
    });
    const [primary] = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));
    const mime = buildMime({
      messageId: "<replay@external.test>",
      body: "Replay body",
    });

    const first = await stagePendingDirect(db, payloadStore, {
      providerEventId: `${FIXTURE}-replay-a`,
      mime,
      recipientAddress: primary!.address,
    });
    const second = await stagePendingDirect(db, payloadStore, {
      providerEventId: `${FIXTURE}-replay-b`,
      mime,
      recipientAddress: primary!.address,
    });

    const matA = await materializeInboundIngestionEvent(
      db,
      { rawPayloadStore: payloadStore, attachmentStore },
      { ingestionEventId: first.ingestionEventId },
    );
    const matB = await materializeInboundIngestionEvent(
      db,
      { rawPayloadStore: payloadStore, attachmentStore },
      { ingestionEventId: second.ingestionEventId },
    );

    assert.equal(matA.message.id, matB.message.id);
    assert.notEqual(matA.materialization.id, matB.materialization.id);
    const mats = await db
      .select()
      .from(schema.mailInboundMessageMaterializations)
      .where(eq(schema.mailInboundMessageMaterializations.mailMessageId, matA.message.id));
    assert.equal(mats.length, 2);
  });

  it("RFC collision with different semantics quarantines second ingestion", async () => {
    await cleanupFixtures(db);
    const mailbox = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("collision"),
      mailboxType: "shared",
    });
    const [primary] = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));

    const first = await stagePendingDirect(db, payloadStore, {
      providerEventId: `${FIXTURE}-collision-a`,
      mime: buildMime({ messageId: "<collision@external.test>", subject: "One" }),
      recipientAddress: primary!.address,
    });
    await materializeInboundIngestionEvent(
      db,
      { rawPayloadStore: payloadStore, attachmentStore },
      { ingestionEventId: first.ingestionEventId },
    );

    const second = await stagePendingDirect(db, payloadStore, {
      providerEventId: `${FIXTURE}-collision-b`,
      mime: buildMime({ messageId: "<collision@external.test>", subject: "Two" }),
      recipientAddress: primary!.address,
    });

    await assert.rejects(
      () =>
        materializeInboundIngestionEvent(
          db,
          { rawPayloadStore: payloadStore, attachmentStore },
          { ingestionEventId: second.ingestionEventId },
        ),
      (error: unknown) =>
        error instanceof Error && /INTEGRITY_CONFLICT|collision/i.test(error.message),
    );

    const [provider] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, second.ingestionEventId));
    assert.equal(provider?.status, "quarantined");
    assert.equal(provider?.quarantineReason, INBOUND_QUARANTINE_REASONS.rfcMessageIdCollision);

    const messages = await db
      .select()
      .from(schema.mailMessages)
      .where(
        eq(schema.mailMessages.internetMessageId, "<collision@external.test>"),
      );
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.subject, "One");
  });

  it("materializes using frozen fallback mailbox, not live config drift", async () => {
    await cleanupFixtures(db);
    const archivedId = `${FIXTURE}-drift-archived`;
    const fallbackA = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("mat-fallback-a"),
      mailboxType: "shared",
    });
    const fallbackB = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("mat-fallback-b"),
      mailboxType: "shared",
    });
    await setInboundFallbackMailbox(db, superAdminActor(), {
      mailboxId: fallbackA.id,
    });

    await insertFixtureMailbox(db, {
      id: archivedId,
      address: fixtureAddress("mat-archived"),
      status: "archived",
    });
    const raAddress = fixtureAddress("mat-route");
    await insertReceivingAddress(db, {
      id: `${FIXTURE}-ra-mat-drift`,
      mailboxId: archivedId,
      address: raAddress,
      status: "suspended",
    });

    const staged = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-mat-drift`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: buildMime({ messageId: "<drift@external.test>" }),
      envelopeRecipients: [raAddress],
    });
    const eventId = staged.envelopeResults[0]!.ingestionEventId;

    await setInboundFallbackMailbox(db, superAdminActor(), {
      mailboxId: fallbackB.id,
    });

    const result = await materializeInboundIngestionEvent(
      db,
      { rawPayloadStore: payloadStore, attachmentStore },
      { ingestionEventId: eventId },
    );
    assert.equal(result.mailboxId, fallbackA.id);
    assert.notEqual(result.mailboxId, fallbackB.id);
  });

  it("quarantines when frozen fallback mailbox becomes unusable", async () => {
    await cleanupFixtures(db);
    const archivedId = `${FIXTURE}-unusable-archived`;
    const fallbackA = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("unusable-fallback"),
      mailboxType: "shared",
    });
    await setInboundFallbackMailbox(db, superAdminActor(), {
      mailboxId: fallbackA.id,
    });
    await insertFixtureMailbox(db, {
      id: archivedId,
      address: fixtureAddress("unusable-archived"),
      status: "archived",
    });
    const raAddress = fixtureAddress("unusable-route");
    await insertReceivingAddress(db, {
      id: `${FIXTURE}-ra-unusable`,
      mailboxId: archivedId,
      address: raAddress,
      status: "suspended",
    });

    const staged = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-unusable`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: buildMime({ messageId: "<unusable@external.test>" }),
      envelopeRecipients: [raAddress],
    });
    const eventId = staged.envelopeResults[0]!.ingestionEventId;

    await db
      .update(schema.mailMailboxes)
      .set({ status: "suspended", updatedAt: new Date().toISOString() })
      .where(eq(schema.mailMailboxes.id, fallbackA.id));

    await assert.rejects(() =>
      materializeInboundIngestionEvent(
        db,
        { rawPayloadStore: payloadStore, attachmentStore },
        { ingestionEventId: eventId },
      ),
    );

    const [provider] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, eventId));
    assert.equal(provider?.status, "quarantined");
    assert.equal(
      provider?.quarantineReason,
      INBOUND_QUARANTINE_REASONS.materializationTargetUnusable,
    );
  });

  it("stores attachments privately with unscanned scan status", async () => {
    await cleanupFixtures(db);
    const mailbox = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("attach"),
      mailboxType: "shared",
    });
    const [primary] = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));
    const attachmentContent = "file-bytes";
    const mime = buildMime({
      messageId: "<attach@external.test>",
      attachment: { filename: "report.pdf", content: attachmentContent },
    });
    const staged = await stagePendingDirect(db, payloadStore, {
      providerEventId: `${FIXTURE}-attach`,
      mime,
      recipientAddress: primary!.address,
    });

    const result = await materializeInboundIngestionEvent(
      db,
      { rawPayloadStore: payloadStore, attachmentStore },
      { ingestionEventId: staged.ingestionEventId },
    );

    const attachments = await db
      .select()
      .from(schema.mailMessageAttachments)
      .where(eq(schema.mailMessageAttachments.messageId, result.message.id));
    assert.equal(attachments.length, 1);

    const [storedFile] = await db
      .select()
      .from(schema.mailStoredFiles)
      .where(eq(schema.mailStoredFiles.id, attachments[0]!.storedFileId));
    assert.equal(storedFile?.securityScanStatus, "unscanned");
    assert.equal(
      storedFile?.contentHash,
      computeInboundPayloadContentHash(new TextEncoder().encode(attachmentContent)),
    );
    assert.ok(storedFile?.storageKey.startsWith("mail/inbound-attachments/"));
    assert.ok(attachmentStore.getObject(storedFile!.storageKey));
  });

  it("quarantines on raw payload hash mismatch", async () => {
    await cleanupFixtures(db);
    const mailbox = await createMailbox(db, superAdminActor(), {
      address: fixtureAddress("hash"),
      mailboxType: "shared",
    });
    const [primary] = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));
    const mime = buildMime({ messageId: "<hash@external.test>" });
    const staged = await stagePendingDirect(db, payloadStore, {
      providerEventId: `${FIXTURE}-hash`,
      mime,
      recipientAddress: primary!.address,
    });

    const [provider] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, staged.ingestionEventId));
    const key = provider!.payloadStorageKey!;
    payloadStore.replaceForTest(key, new TextEncoder().encode("tampered bytes"));

    await assert.rejects(() =>
      materializeInboundIngestionEvent(
        db,
        { rawPayloadStore: payloadStore, attachmentStore },
        { ingestionEventId: staged.ingestionEventId },
      ),
    );

    const [after] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, staged.ingestionEventId));
    assert.equal(after?.status, "quarantined");
    assert.equal(after?.quarantineReason, INBOUND_QUARANTINE_REASONS.payloadIntegrityConflict);
    assert.ok(key);
  });
});
