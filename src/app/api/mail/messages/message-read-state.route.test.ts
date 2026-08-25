import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { handlePatchMailMessageReadState } from "@/app/api/mail/messages/[id]/read-state/route";
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

describe("PATCH /api/mail/messages/[id]/read-state", () => {
  let db: TestDb;
  let dispose: (() => Promise<void>) | undefined;
  let mailboxId: string;
  let messageId: string;

  before(async () => {
    const setup = await setupMailReadApiDb();
    db = setup.db;
    dispose = setup.dispose;
    mailboxId = setup.mailboxId;
    messageId = `${fixtureAddress("read-state")}-msg`;
    await insertMessage(db, { id: messageId, mailboxId, direction: "inbound" });
  });

  after(async () => {
    await teardownMailReadApiDb(db, dispose);
  });

  function patchRequest(
    id: string,
    body: Record<string, unknown>,
    query = "folder=inbox",
  ) {
    return new Request(
      `http://localhost/api/mail/messages/${id}/read-state?${query}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }

  it("marks message read", async () => {
    const freshId = `${fixtureAddress("read")}-msg`;
    await insertMessage(db, { id: freshId, mailboxId, direction: "inbound" });
    const res = await handlePatchMailMessageReadState(
      patchRequest(freshId, { isRead: true }),
      freshId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as { item: { isRead: boolean; readAt: string | null } };
    assert.equal(json.item.isRead, true);
    assert.ok(json.item.readAt);
  });

  it("marks message unread", async () => {
    const freshId = `${fixtureAddress("unread")}-msg`;
    await insertMessage(db, { id: freshId, mailboxId, direction: "inbound" });
    await handlePatchMailMessageReadState(
      patchRequest(freshId, { isRead: true }),
      freshId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    const res = await handlePatchMailMessageReadState(
      patchRequest(freshId, { isRead: false }),
      freshId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    const json = (await res.json()) as { item: { isRead: boolean; readAt: string | null } };
    assert.equal(json.item.isRead, false);
    assert.equal(json.item.readAt, null);
  });

  it("preserves read state on important-only patch", async () => {
    const freshId = `${fixtureAddress("important-only")}-msg`;
    await insertMessage(db, { id: freshId, mailboxId, direction: "inbound" });
    const res = await handlePatchMailMessageReadState(
      patchRequest(freshId, { isImportantPersonal: true }),
      freshId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    const json = (await res.json()) as {
      item: { isRead: boolean; isImportantPersonal: boolean };
    };
    assert.equal(json.item.isImportantPersonal, true);
    assert.equal(json.item.isRead, false);
  });

  it("preserves important state on read-only patch", async () => {
    const freshId = `${fixtureAddress("read-only")}-msg`;
    await insertMessage(db, { id: freshId, mailboxId, direction: "inbound" });
    await handlePatchMailMessageReadState(
      patchRequest(freshId, { isImportantPersonal: true }),
      freshId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    const res = await handlePatchMailMessageReadState(
      patchRequest(freshId, { isRead: true }),
      freshId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    const json = (await res.json()) as {
      item: { isRead: boolean; isImportantPersonal: boolean };
    };
    assert.equal(json.item.isRead, true);
    assert.equal(json.item.isImportantPersonal, true);
  });

  it("rejects empty patch with 400", async () => {
    const res = await handlePatchMailMessageReadState(
      patchRequest(messageId, {}),
      messageId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(res.status, 400);
  });

  it("rejects invalid boolean with 400", async () => {
    const res = await handlePatchMailMessageReadState(
      patchRequest(messageId, { isRead: "yes" }),
      messageId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(res.status, 400);
  });

  it("rejects trashed message without trash context", async () => {
    const trashedId = `${fixtureAddress("trashed-state")}-msg`;
    await insertMessage(db, {
      id: trashedId,
      mailboxId,
      direction: "inbound",
      trashedAt: new Date().toISOString(),
    });

    const res = await handlePatchMailMessageReadState(
      new Request(
        `http://localhost/api/mail/messages/${trashedId}/read-state?folder=inbox`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isRead: true }),
        },
      ),
      trashedId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(res.status, 403);
  });

  it("allows trashed message with folder=trash", async () => {
    const trashedId = `${fixtureAddress("trashed-state-ok")}-msg`;
    await insertMessage(db, {
      id: trashedId,
      mailboxId,
      direction: "inbound",
      trashedAt: new Date().toISOString(),
    });

    const res = await handlePatchMailMessageReadState(
      new Request(
        `http://localhost/api/mail/messages/${trashedId}/read-state?folder=trash`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isRead: true }),
        },
      ),
      trashedId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(res.status, 200);
  });

  it("preserves non-enumeration for cross-mailbox read-state mutation", async () => {
    const foreignMailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("foreign-read-state"),
      mailboxType: "shared",
    });
    const foreignId = `${fixtureAddress("foreign-read-state")}-msg`;
    await insertMessage(db, {
      id: foreignId,
      mailboxId: foreignMailbox.id,
      direction: "inbound",
    });

    const res = await handlePatchMailMessageReadState(
      patchRequest(foreignId, { isRead: true }),
      foreignId,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(res.status, 404);
  });
});
