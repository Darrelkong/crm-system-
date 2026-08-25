import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { handleGetMailMessages } from "@/app/api/mail/messages/route";
import {
  actor,
  fixtureAddress,
  insertMessage,
  makeRequireMailActor,
  setupMailReadApiDb,
  teardownMailReadApiDb,
  type TestDb,
} from "@/app/api/mail/mail-read-route-test-helpers";

describe("GET /api/mail/messages", () => {
  let db: TestDb;
  let dispose: (() => Promise<void>) | undefined;
  let mailboxId: string;
  let senderIdentityId: string;

  before(async () => {
    const setup = await setupMailReadApiDb();
    db = setup.db;
    dispose = setup.dispose;
    mailboxId = setup.mailboxId;
    senderIdentityId = setup.senderIdentityId;
  });

  after(async () => {
    await teardownMailReadApiDb(db, dispose);
  });

  function listUrl(params: Record<string, string>) {
    const search = new URLSearchParams(params);
    return `http://localhost/api/mail/messages?${search.toString()}`;
  }

  it("returns inbox inbound non-trash messages only", async () => {
    const inboundId = `${fixtureAddress("inbox")}-msg`;
    await insertMessage(db, {
      id: inboundId,
      mailboxId,
      direction: "inbound",
      subject: "Inbox only",
    });
    await insertMessage(db, {
      id: `${inboundId}-sent`,
      mailboxId,
      direction: "outbound",
      senderIdentityId,
    });

    const res = await handleGetMailMessages(
      new Request(listUrl({ mailboxId, folder: "inbox" })),
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as { items: Array<{ id: string; direction: string }> };
    assert.ok(json.items.some((item) => item.id === inboundId));
    assert.ok(json.items.every((item) => item.direction === "inbound"));
  });

  it("returns sent outbound non-trash messages only", async () => {
    const sentId = `${fixtureAddress("sent")}-msg`;
    await insertMessage(db, {
      id: sentId,
      mailboxId,
      direction: "outbound",
      senderIdentityId,
    });

    const res = await handleGetMailMessages(
      new Request(listUrl({ mailboxId, folder: "sent" })),
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    const json = (await res.json()) as { items: Array<{ id: string }> };
    assert.ok(json.items.some((item) => item.id === sentId));
  });

  it("returns trashed messages only in trash folder", async () => {
    const trashedId = `${fixtureAddress("trash")}-msg`;
    await insertMessage(db, {
      id: trashedId,
      mailboxId,
      direction: "inbound",
      trashedAt: "2026-08-20T10:00:00.000Z",
    });

    const res = await handleGetMailMessages(
      new Request(listUrl({ mailboxId, folder: "trash" })),
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    const json = (await res.json()) as { items: Array<{ id: string }> };
    assert.ok(json.items.some((item) => item.id === trashedId));
  });

  it("denies unauthorized mailbox according to service semantics", async () => {
    const res = await handleGetMailMessages(
      new Request(listUrl({ mailboxId, folder: "inbox" })),
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffB)) },
    );
    assert.equal(res.status, 403);
  });

  it("returns safe list DTO without body, recipients, or CRM fields", async () => {
    const messageId = `${fixtureAddress("safe-list")}-msg`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      withBcc: true,
    });

    const res = await handleGetMailMessages(
      new Request(listUrl({ mailboxId, folder: "inbox", limit: "50" })),
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    const json = (await res.json()) as { items: Array<Record<string, unknown>> };
    const row = json.items.find((item) => item.id === messageId);
    assert.ok(row);
    assert.equal("bodyText" in row, false);
    assert.equal("bodyHtml" in row, false);
    assert.equal("recipients" in row, false);
    assert.equal("customerAssociation" in row, false);
  });

  it("paginates with stable nextCursor and no duplicates", async () => {
    const base = `${fixtureAddress("cursor")}`;
    for (let index = 0; index < 3; index += 1) {
      await insertMessage(db, {
        id: `${base}-msg-${index}`,
        mailboxId,
        direction: "inbound",
        receivedAt: `2026-08-2${index}T10:00:00.000Z`,
      });
    }

    const first = await handleGetMailMessages(
      new Request(listUrl({ mailboxId, folder: "inbox", limit: "2" })),
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    const firstJson = (await first.json()) as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    assert.equal(firstJson.items.length, 2);
    assert.ok(firstJson.nextCursor);

    const second = await handleGetMailMessages(
      new Request(
        listUrl({
          mailboxId,
          folder: "inbox",
          limit: "2",
          cursor: firstJson.nextCursor!,
        }),
      ),
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    const secondJson = (await second.json()) as { items: Array<{ id: string }> };
    const ids = [...firstJson.items, ...secondJson.items].map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("returns 400 for invalid folder", async () => {
    const res = await handleGetMailMessages(
      new Request(listUrl({ mailboxId, folder: "drafts" })),
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(res.status, 400);
  });

  it("returns 400 for invalid limit", async () => {
    const res = await handleGetMailMessages(
      new Request(listUrl({ mailboxId, folder: "inbox", limit: "abc" })),
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(res.status, 400);
  });

  it("returns 400 for malformed cursor instead of 500", async () => {
    const res = await handleGetMailMessages(
      new Request(
        listUrl({ mailboxId, folder: "inbox", cursor: "not-a-valid-cursor" }),
      ),
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(res.status, 400);
  });
});
