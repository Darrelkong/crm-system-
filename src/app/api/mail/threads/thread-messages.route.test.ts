import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { handleGetMailThread } from "@/app/api/mail/threads/[id]/route";
import { createMailbox } from "@/lib/mail/mailbox-service";
import {
  actor,
  adminActor,
  fixtureAddress,
  insertMessage,
  makeRequireMailActor,
  setupMailReadApiDb,
  teardownMailReadApiDb,
  type TestDb,
} from "@/app/api/mail/mail-read-route-test-helpers";

describe("GET /api/mail/threads/[id]", () => {
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

  it("returns authorized thread in readable mailbox", async () => {
    const threadId = `${fixtureAddress("thread")}-thread`;
    await insertMessage(db, {
      id: `${fixtureAddress("thread")}-msg-1`,
      mailboxId,
      direction: "inbound",
      threadId,
      createdAt: "2026-08-20T10:00:00.000Z",
    });
    await insertMessage(db, {
      id: `${fixtureAddress("thread")}-msg-2`,
      mailboxId,
      direction: "inbound",
      threadId,
      createdAt: "2026-08-21T10:00:00.000Z",
    });

    const res = await handleGetMailThread(
      new Request(
        `http://localhost/api/mail/threads/${threadId}?mailboxId=${mailboxId}`,
      ),
      threadId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      thread: { id: string; messageCount: number };
      items: Array<{ id: string }>;
    };
    assert.equal(json.thread.id, threadId);
    assert.equal(json.items.length, 2);
  });

  it("denies thread from inaccessible mailbox", async () => {
    const foreignMailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("foreign-thread"),
      mailboxType: "shared",
    });
    const threadId = `${fixtureAddress("foreign-thread")}-thread`;
    await insertMessage(db, {
      id: `${fixtureAddress("foreign-thread")}-msg`,
      mailboxId: foreignMailbox.id,
      direction: "inbound",
      threadId,
    });

    const res = await handleGetMailThread(
      new Request(
        `http://localhost/api/mail/threads/${threadId}?mailboxId=${foreignMailbox.id}`,
      ),
      threadId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(res.status, 403);
  });

  it("returns safe list DTOs only for thread items", async () => {
    const threadId = `${fixtureAddress("thread-safe")}-thread`;
    await insertMessage(db, {
      id: `${fixtureAddress("thread-safe")}-msg`,
      mailboxId,
      direction: "inbound",
      threadId,
      withBcc: true,
    });

    const res = await handleGetMailThread(
      new Request(
        `http://localhost/api/mail/threads/${threadId}?mailboxId=${mailboxId}`,
      ),
      threadId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    const json = (await res.json()) as { items: Array<Record<string, unknown>> };
    for (const item of json.items) {
      assert.equal("bodyText" in item, false);
      assert.equal("recipients" in item, false);
      assert.equal("customerAssociation" in item, false);
    }
  });

  it("orders thread messages oldest to newest", async () => {
    const threadId = `${fixtureAddress("thread-order")}-thread`;
    const olderId = `${fixtureAddress("thread-order")}-older`;
    const newerId = `${fixtureAddress("thread-order")}-newer`;
    await insertMessage(db, {
      id: olderId,
      mailboxId,
      direction: "inbound",
      threadId,
      createdAt: "2026-08-20T10:00:00.000Z",
    });
    await insertMessage(db, {
      id: newerId,
      mailboxId,
      direction: "inbound",
      threadId,
      createdAt: "2026-08-21T10:00:00.000Z",
    });

    const res = await handleGetMailThread(
      new Request(
        `http://localhost/api/mail/threads/${threadId}?mailboxId=${mailboxId}`,
      ),
      threadId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    const json = (await res.json()) as { items: Array<{ id: string }> };
    assert.deepEqual(
      json.items.map((item) => item.id),
      [olderId, newerId],
    );
  });
});
