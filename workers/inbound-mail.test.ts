import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import {
  InboundEmailIngressError,
} from "@/lib/mail/cloudflare-email-inbound-adapter";
import { INBOUND_EMAIL_RECIPIENT_REJECT_REASON } from "@/lib/mail/inbound-email-recipient-reject";
import { createMailbox } from "@/lib/mail/mailbox-service";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import {
  assertInboundMailBindings,
  handleInboundEmailDelivery,
  handleCloudflareInboundEmail,
  type InboundMailEnv,
} from "./inbound-mail";

const ROOT = process.cwd();
const FIXTURE = "mail-phase1d12p";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function read(path: string): string {
  return readFileSync(`${ROOT}/${path}`, "utf8");
}

function actor(): MailActorContext {
  return {
    userId: SEED_IDS.admin,
    sessionId: null,
    crmRole: "admin",
    mailAccessEnabled: true,
    adminGrants: ["super_admin"],
    audit: { ipAddress: "127.0.0.1", userAgent: "phase1d12p-test" },
  };
}

function fixtureAddress(localPart: string): string {
  return `${FIXTURE}-${localPart}@echfronthk.com`;
}

function mockEmailMessage(
  raw: string,
  to = fixtureAddress("known"),
) {
  const rawBytes = new TextEncoder().encode(raw);
  let rejectCount = 0;
  let rejectReason: string | undefined;

  const message = {
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
    setReject(reason: string) {
      rejectCount += 1;
      rejectReason = reason;
    },
    getRejectCount: () => rejectCount,
    getRejectReason: () => rejectReason,
  };

  return message;
}

function tinyMime(body = "Inbound worker test body"): string {
  return [
    "From: Sender <sender@external.test>",
    "To: Recipient <recipient@echfronthk.com>",
    "Subject: Inbound worker test",
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

describe("inbound mail worker delivery boundary", () => {
  let db: TestDb;
  let env: InboundMailEnv;
  let dispose: (() => Promise<void>) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    process.env.NODE_ENV = "test";
    const proxy = await getTestD1PlatformProxy<{ DB: D1Database; ATTACHMENTS: R2Bucket }>({
      configPath: "wrangler.inbound-mail.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    env = {
      DB: proxy.env.DB,
      ATTACHMENTS: proxy.env.ATTACHMENTS,
    };
    dispose = proxy.dispose;
  });

  after(async () => {
    await dispose?.();
  });

  it("accepts known recipient without calling setReject", async () => {
    await cleanupFixtures(db);
    const receivingAddress = fixtureAddress("known");
    await createMailbox(db, actor(), {
      address: receivingAddress,
      mailboxType: "shared",
    });

    const message = mockEmailMessage(tinyMime(), receivingAddress);
    const outcome = await handleInboundEmailDelivery(message, env);

    assert.equal(outcome, "accepted");
    assert.equal(message.getRejectCount(), 0);
  });

  it("explicitly rejects unknown recipient after quarantine staging", async () => {
    await cleanupFixtures(db);
    const unknownAddress = fixtureAddress("unknown");
    const message = mockEmailMessage(tinyMime("unknown body"), unknownAddress);

    const outcome = await handleInboundEmailDelivery(message, env);

    assert.equal(outcome, "rejected");
    assert.equal(message.getRejectCount(), 1);
    assert.equal(message.getRejectReason(), INBOUND_EMAIL_RECIPIENT_REJECT_REASON);

    const inboundChildren = await db
      .select()
      .from(schema.mailInboundIngestionEvents)
      .where(eq(schema.mailInboundIngestionEvents.envelopeRecipientAddress, unknownAddress));
    assert.equal(inboundChildren.length, 1);

    const [providerRow] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, inboundChildren[0]!.ingestionEventId));
    assert.equal(providerRow?.status, "quarantined");

    const messages = await db
      .select()
      .from(schema.mailMessages)
      .where(like(schema.mailMessages.subject, "%Inbound worker test%"));
    assert.equal(messages.length, 0);
  });

  it("dedupes repeated unknown recipient deliveries without duplicate provider rows", async () => {
    await cleanupFixtures(db);
    const unknownAddress = fixtureAddress("unknown-dedupe");
    const raw = tinyMime("unknown dedupe body");

    const first = mockEmailMessage(raw, unknownAddress);
    const second = mockEmailMessage(raw, unknownAddress);

    assert.equal(await handleInboundEmailDelivery(first, env), "rejected");
    assert.equal(await handleInboundEmailDelivery(second, env), "rejected");
    assert.equal(first.getRejectCount(), 1);
    assert.equal(second.getRejectCount(), 1);

    const inboundChildren = await db
      .select()
      .from(schema.mailInboundIngestionEvents)
      .where(eq(schema.mailInboundIngestionEvents.envelopeRecipientAddress, unknownAddress));
    assert.equal(inboundChildren.length, 1);
  });

  it("does not call setReject for missing bindings", async () => {
    const message = mockEmailMessage(tinyMime());
    await assert.rejects(
      () =>
        handleInboundEmailDelivery(message, {
          DB: undefined as unknown as D1Database,
          ATTACHMENTS: {} as R2Bucket,
        }),
      /DB D1 binding/,
    );
    assert.equal(message.getRejectCount(), 0);
  });

  it("does not call setReject for empty MIME ingress errors", async () => {
    const message = mockEmailMessage("");
    await assert.rejects(
      () => handleInboundEmailDelivery(message, env),
      (error: unknown) => {
        assert.ok(error instanceof InboundEmailIngressError);
        assert.equal(error.code, "EMPTY_RAW_MIME");
        return true;
      },
    );
    assert.equal(message.getRejectCount(), 0);
  });
});

describe("inbound mail worker static config", () => {
  it("wrangler.inbound-mail.jsonc uses isolated worker name and minimum bindings", () => {
    const config = read("wrangler.inbound-mail.jsonc");
    assert.match(config, /"name":\s*"crm-system-inbound-mail"/);
    assert.match(config, /"main":\s*"workers\/inbound-mail.ts"/);
    assert.match(config, /"binding":\s*"DB"/);
    assert.match(config, /"database_name":\s*"crm-db"/);
    assert.match(config, /"binding":\s*"ATTACHMENTS"/);
    assert.match(config, /"bucket_name":\s*"crm-attachments"/);
    assert.match(config, /"workers_dev":\s*false/);
    assert.doesNotMatch(config, /"send_email"/);
    assert.doesNotMatch(config, /"routes"/);
    assert.doesNotMatch(config, /"crons"/);
  });

  it("worker source exports email handler only and reuses staging adapter", () => {
    const worker = read("workers/inbound-mail.ts");
    assert.match(worker, /async email/);
    assert.doesNotMatch(worker, /async fetch/);
    assert.doesNotMatch(worker, /async scheduled/);
    assert.match(worker, /stageCloudflareInboundEmail/);
    assert.match(worker, /rejectInboundEmailRecipient/);
    assert.match(worker, /handleInboundEmailDelivery/);
    assert.doesNotMatch(worker, /\.reply\(/);
    assert.doesNotMatch(worker, /\.forward\(/);
    assert.doesNotMatch(worker, /send_email/);
    assert.doesNotMatch(worker, /SendEmail/);
    assert.doesNotMatch(worker, /message\.reply\(/);
    assert.doesNotMatch(worker, /message\.forward\(/);
  });

  it("package scripts declare deploy and dry-run only", () => {
    const pkg = read("package.json");
    assert.match(pkg, /"inbound-mail:deploy"/);
    assert.match(pkg, /"inbound-mail:dry-run"/);
  });
});

describe("inbound mail worker wiring", () => {
  it("fails clearly when DB binding is missing", () => {
    assert.throws(
      () =>
        assertInboundMailBindings({
          DB: undefined as unknown as D1Database,
          ATTACHMENTS: {} as R2Bucket,
        }),
      /DB D1 binding/,
    );
  });

  it("fails clearly when ATTACHMENTS binding is missing", () => {
    assert.throws(
      () =>
        assertInboundMailBindings({
          DB: {} as D1Database,
          ATTACHMENTS: undefined as unknown as R2Bucket,
        }),
      /ATTACHMENTS R2 binding/,
    );
  });

  it("handleCloudflareInboundEmail rejects missing bindings before staging", async () => {
    await assert.rejects(
      () =>
        handleCloudflareInboundEmail(
          mockEmailMessage("From: a@b\n\nx"),
          {
            DB: undefined as unknown as D1Database,
            ATTACHMENTS: {} as R2Bucket,
          },
        ),
      /DB D1 binding/,
    );
  });
});
