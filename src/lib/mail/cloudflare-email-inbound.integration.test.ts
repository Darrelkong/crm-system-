import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import { MemoryInboundAttachmentStore } from "@/lib/mail/inbound-attachment-store";
import { stageCloudflareInboundEmail } from "@/lib/mail/cloudflare-email-inbound-adapter";
import { materializeInboundIngestionEvent } from "@/lib/mail/inbound-message-materialization-service";
import { MemoryInboundRawPayloadStore } from "@/lib/mail/inbound-raw-payload-store";
import { createMailbox } from "@/lib/mail/mailbox-service";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { SEED_IDS } from "@/lib/constants/seed-ids";

const FIXTURE = "mail-phase2h6m2lr";
const RECEIVED_AT = "2026-08-26T15:50:00.000Z";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(): MailActorContext {
  return {
    userId: SEED_IDS.admin,
    sessionId: null,
    crmRole: "admin",
    mailAccessEnabled: true,
    adminGrants: ["super_admin"],
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2h6m2lr-test" },
  };
}

function fixtureAddress(localPart: string): string {
  return `${FIXTURE}-${localPart}@echfronthk.com`;
}

function mockEmail(to: string, raw: string) {
  const rawBytes = new TextEncoder().encode(raw);
  return {
    from: "sender@external.test",
    to,
    headers: new Headers(),
    rawSize: rawBytes.byteLength,
    raw: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(rawBytes);
        controller.close();
      },
    }),
  };
}

function tinyMime(body = "Inbound foundation test body"): string {
  return [
    "From: Sender <sender@external.test>",
    "To: Daniel <daniel@echfronthk.com>",
    "Subject: Inbound foundation test",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join("\r\n");
}

async function cleanupFixtures(db: TestDb) {
  const mailboxes = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.address, `${FIXTURE}%`));

  for (const { id: mailboxId } of mailboxes) {
    const messages = await db
      .select({ id: schema.mailMessages.id })
      .from(schema.mailMessages)
      .where(eq(schema.mailMessages.mailboxId, mailboxId));

    for (const { id: messageId } of messages) {
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
    }

    const materializations = await db
      .select({
        ingestionEventId: schema.mailInboundMessageMaterializations.ingestionEventId,
      })
      .from(schema.mailInboundMessageMaterializations)
      .where(eq(schema.mailInboundMessageMaterializations.routeOwnerMailboxId, mailboxId));

    for (const row of materializations) {
      await db
        .delete(schema.mailInboundMessageMaterializations)
        .where(
          eq(
            schema.mailInboundMessageMaterializations.ingestionEventId,
            row.ingestionEventId,
          ),
        );
    }

    await db
      .delete(schema.mailMessages)
      .where(eq(schema.mailMessages.mailboxId, mailboxId));
    await db
      .delete(schema.mailThreads)
      .where(eq(schema.mailThreads.mailboxId, mailboxId));

    const inboundChildren = await db
      .select({ ingestionEventId: schema.mailInboundIngestionEvents.ingestionEventId })
      .from(schema.mailInboundIngestionEvents)
      .where(like(schema.mailInboundIngestionEvents.envelopeRecipientAddress, `${FIXTURE}%`));

    for (const { ingestionEventId } of inboundChildren) {
      await db
        .delete(schema.mailInboundIngestionEvents)
        .where(eq(schema.mailInboundIngestionEvents.ingestionEventId, ingestionEventId));
      await db
        .delete(schema.mailProviderIngestionEvents)
        .where(eq(schema.mailProviderIngestionEvents.id, ingestionEventId));
    }

    await db
      .delete(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, mailboxId));
    await db
      .delete(schema.mailMailboxMembers)
      .where(eq(schema.mailMailboxMembers.mailboxId, mailboxId));
    await db
      .delete(schema.mailMailboxes)
      .where(eq(schema.mailMailboxes.id, mailboxId));
  }
}

describe("cloudflare email inbound minimal integration", () => {
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

  after(() => {
    dispose?.();
  });

  it("stages and materializes one tiny plain-text message", async () => {
    await cleanupFixtures(db);
    const receivingAddress = fixtureAddress("daniel");
    const mailbox = await createMailbox(db, actor(), {
      address: receivingAddress,
      displayName: "Daniel fixture",
      mailboxType: "shared",
    });

    const staged = await stageCloudflareInboundEmail(
      db,
      payloadStore,
      mockEmail(receivingAddress, tinyMime()),
      { receivedAt: RECEIVED_AT },
    );
    assert.equal(
      staged.envelopeResults[0]?.routeDecision,
      "direct",
      `route=${staged.envelopeResults[0]?.routeDecision} reason=${staged.envelopeResults[0]?.quarantineReason}`,
    );

    const materialized = await materializeInboundIngestionEvent(
      db,
      { rawPayloadStore: payloadStore, attachmentStore },
      { ingestionEventId: staged.envelopeResults[0]!.ingestionEventId },
    );

    assert.equal(materialized.mailboxId, mailbox.id);
    assert.equal(materialized.message.subject, "Inbound foundation test");

    const messages = await db
      .select()
      .from(schema.mailMessages)
      .where(eq(schema.mailMessages.mailboxId, mailbox.id));
    assert.equal(messages.length, 1);
  });

  it("dedupes identical tiny raw MIME for the same envelope recipient", async () => {
    await cleanupFixtures(db);
    const receivingAddress = fixtureAddress("daniel-dedupe");
    await createMailbox(db, actor(), {
      address: receivingAddress,
      mailboxType: "shared",
    });

    const raw = tinyMime("duplicate body");
    const first = await stageCloudflareInboundEmail(
      db,
      payloadStore,
      mockEmail(receivingAddress, raw),
      { receivedAt: RECEIVED_AT },
    );
    const second = await stageCloudflareInboundEmail(
      db,
      payloadStore,
      mockEmail(receivingAddress, raw),
      { receivedAt: RECEIVED_AT },
    );

    assert.equal(first.envelopeResults[0]?.idempotentReplay, false);
    assert.equal(second.envelopeResults[0]?.idempotentReplay, true);
    assert.equal(
      first.envelopeResults[0]?.ingestionEventId,
      second.envelopeResults[0]?.ingestionEventId,
    );
  });
});
