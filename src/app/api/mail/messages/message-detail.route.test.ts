import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { schema } from "@/lib/db";
import { handleGetMailMessageDetail } from "@/app/api/mail/messages/[id]/route";
import {
  actor,
  fixtureAddress,
  insertMessage,
  makeRequireMailActor,
  setupMailReadApiDb,
  teardownMailReadApiDb,
  type TestDb,
} from "@/app/api/mail/mail-read-route-test-helpers";

describe("GET /api/mail/messages/[id]", () => {
  let db: TestDb;
  let dispose: (() => Promise<void>) | undefined;
  let mailboxId: string;

  before(async () => {
    const setup = await setupMailReadApiDb();
    db = setup.db;
    dispose = setup.dispose;
    mailboxId = setup.mailboxId;
  });

  after(async () => {
    await teardownMailReadApiDb(db, dispose);
  });

  it("returns authorized message detail", async () => {
    const messageId = `${fixtureAddress("detail")}-msg`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      bodyText: "Detail body",
      bodyHtml: "<p>Detail html</p>",
    });

    const res = await handleGetMailMessageDetail(
      new Request(`http://localhost/api/mail/messages/${messageId}?folder=inbox`),
      messageId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      item: {
        id: string;
        bodyText: string;
        bodyHtml: string | null;
        customerAssociation: unknown;
      };
    };
    assert.equal(json.item.id, messageId);
    assert.equal(json.item.bodyText, "Detail body");
    assert.equal(json.item.bodyHtml, "<p>Detail html</p>");
    assert.equal(json.item.customerAssociation, null);
  });

  it("preserves NOT_FOUND for cross-mailbox unauthorized message", async () => {
    const messageId = `${fixtureAddress("private")}-msg`;
    await insertMessage(db, { id: messageId, mailboxId, direction: "inbound" });

    const res = await handleGetMailMessageDetail(
      new Request(`http://localhost/api/mail/messages/${messageId}?folder=inbox`),
      messageId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffB)) },
    );
    assert.equal(res.status, 404);
  });

  it("hides Bcc for unauthorized shared-mailbox reader at API boundary", async () => {
    const messageId = `${fixtureAddress("bcc-api")}-msg`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      withBcc: true,
    });

    const res = await handleGetMailMessageDetail(
      new Request(`http://localhost/api/mail/messages/${messageId}?folder=inbox`),
      messageId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    const json = (await res.json()) as {
      item: { recipients: Array<{ recipientType: string }> };
    };
    assert.deepEqual(
      json.item.recipients.map((recipient) => recipient.recipientType),
      ["to"],
    );
  });

  it("shows Bcc only for global_mail_read viewers per Phase 2H-3A rules", async () => {
    const messageId = `${fixtureAddress("bcc-global")}-msg`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      withBcc: true,
    });

    const res = await handleGetMailMessageDetail(
      new Request(`http://localhost/api/mail/messages/${messageId}?folder=inbox`),
      messageId,
      {
        requireMailActor: makeRequireMailActor(
          db,
          actor(SEED_IDS.staffB, { adminGrants: ["global_mail_read"] }),
        ),
      },
    );
    const json = (await res.json()) as {
      item: { recipients: Array<{ recipientType: string }> };
    };
    assert.equal(json.item.recipients.length, 2);
  });

  it("shows Bcc for CRM root admin supervision without global_mail_read grant", async () => {
    const messageId = `${fixtureAddress("bcc-root-admin")}-msg`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      withBcc: true,
    });

    const res = await handleGetMailMessageDetail(
      new Request(`http://localhost/api/mail/messages/${messageId}?folder=inbox`),
      messageId,
      {
        requireMailActor: makeRequireMailActor(
          db,
          actor(SEED_IDS.admin, {
            crmRole: "admin",
            mailAccessEnabled: false,
            adminGrants: [],
          }),
        ),
      },
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      item: { recipients: Array<{ recipientType: string }> };
    };
    assert.equal(json.item.recipients.length, 2);
  });

  it("does not expose attachment storage keys", async () => {
    const messageId = `${fixtureAddress("attachment")}-msg`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      withAttachment: true,
    });

    const res = await handleGetMailMessageDetail(
      new Request(`http://localhost/api/mail/messages/${messageId}?folder=inbox`),
      messageId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    const json = (await res.json()) as {
      item: { attachments: Array<Record<string, unknown>> };
    };
    assert.equal(json.item.attachments.length, 1);
    assert.equal("storageKey" in json.item.attachments[0]!, false);
    assert.equal("storedFileId" in json.item.attachments[0]!, false);
    assert.equal(json.item.attachments[0]?.downloadAvailable, true);
    assert.equal("securityScanStatus" in json.item.attachments[0]!, false);
  });

  it("rejects trashed detail without trash context", async () => {
    const messageId = `${fixtureAddress("trashed-detail")}-msg`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      trashedAt: new Date().toISOString(),
    });

    const res = await handleGetMailMessageDetail(
      new Request(`http://localhost/api/mail/messages/${messageId}?folder=inbox`),
      messageId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(res.status, 403);
  });

  it("returns trashed detail with folder=trash for authorized actor", async () => {
    const messageId = `${fixtureAddress("trashed-ok")}-msg`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      trashedAt: new Date().toISOString(),
    });

    const res = await handleGetMailMessageDetail(
      new Request(`http://localhost/api/mail/messages/${messageId}?folder=trash`),
      messageId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(res.status, 200);
  });

  it("exposes server-sanitized bodyHtml only", async () => {
    const messageId = `${fixtureAddress("sanitized-html")}-msg`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      bodyHtml: "<p>Safe html</p>",
    });

    const res = await handleGetMailMessageDetail(
      new Request(`http://localhost/api/mail/messages/${messageId}?folder=inbox`),
      messageId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    const json = (await res.json()) as { item: { bodyHtml: string | null } };
    assert.equal(json.item.bodyHtml, "<p>Safe html</p>");
  });

  it("returns 400 for non-string message ids", async () => {
    const res = await handleGetMailMessageDetail(
      new Request("http://localhost/api/mail/messages/bad?folder=inbox"),
      { id: "bad" } as unknown as string,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(res.status, 400);
    const json = (await res.json()) as { errorCode: string };
    assert.equal(json.errorCode, "VALIDATION");
  });

  it("returns 404 for valid-format nonexistent messages", async () => {
    const res = await handleGetMailMessageDetail(
      new Request(
        "http://localhost/api/mail/messages/00000000-0000-0000-0000-000000000099?folder=inbox",
      ),
      "00000000-0000-0000-0000-000000000099",
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(res.status, 404);
  });

  it("returns NOT_FOUND when message exists without canonical body row", async () => {
    const messageId = `${fixtureAddress("missing-body")}-msg`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      bodyText: "Canonical body",
    });
    await db
      .delete(schema.mailMessageBodies)
      .where(eq(schema.mailMessageBodies.messageId, messageId));

    const res = await handleGetMailMessageDetail(
      new Request(`http://localhost/api/mail/messages/${messageId}?folder=inbox`),
      messageId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(res.status, 404);
    const json = (await res.json()) as { error: string; errorCode: string };
    assert.equal(json.error, "Message body not found");
    assert.equal(json.errorCode, "NOT_FOUND");
  });

  it("denies users without mail access", async () => {
    const messageId = `${fixtureAddress("no-access")}-msg`;
    await insertMessage(db, { id: messageId, mailboxId, direction: "inbound" });

    const res = await handleGetMailMessageDetail(
      new Request(`http://localhost/api/mail/messages/${messageId}?folder=inbox`),
      messageId,
      {
        requireMailActor: makeRequireMailActor(
          db,
          actor(SEED_IDS.staffA, { mailAccessEnabled: false }),
        ),
      },
    );
    assert.equal(res.status, 403);
  });

  it("returns safe customerAssociation when inbound sender matches accessible customer", async () => {
    const messageId = `${fixtureAddress("crm-match")}-msg`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      fromAddress: "staff-a-customer@example.com",
    });

    const res = await handleGetMailMessageDetail(
      new Request(`http://localhost/api/mail/messages/${messageId}?folder=inbox`),
      messageId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      item: {
        customerAssociation: {
          customerId: string;
          associationType: string;
        } | null;
      };
    };
    assert.ok(json.item.customerAssociation);
    assert.equal(json.item.customerAssociation.customerId, SEED_IDS.customerStaffA);
    assert.equal(json.item.customerAssociation.associationType, "auto_match");
  });

  it("returns null customerAssociation when mail is readable but CRM is denied", async () => {
    const messageId = `${fixtureAddress("crm-denied")}-msg`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      fromAddress: "staff-a-customer@example.com",
    });

    const res = await handleGetMailMessageDetail(
      new Request(`http://localhost/api/mail/messages/${messageId}?folder=inbox`),
      messageId,
      {
        requireMailActor: makeRequireMailActor(
          db,
          actor(SEED_IDS.staffB, { adminGrants: ["global_mail_read"] }),
        ),
      },
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      item: { bodyText: string; customerAssociation: unknown };
    };
    assert.equal(json.item.bodyText, "Secret body text");
    assert.equal(json.item.customerAssociation, null);
  });
});
