import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { handleGetAccessibleMailboxes } from "@/app/api/mail/mailboxes/accessible/route";
import { createMailbox } from "@/lib/mail/mailbox-service";
import {
  actor,
  adminActor,
  addMailboxMember,
  fixtureAddress,
  makeRequireMailActor,
  setupMailReadApiDb,
  teardownMailReadApiDb,
  type TestDb,
} from "@/app/api/mail/mail-read-route-test-helpers";

describe("GET /api/mail/mailboxes/accessible", () => {
  let db: TestDb;
  let dispose: (() => Promise<void>) | undefined;

  before(async () => {
    const setup = await setupMailReadApiDb();
    db = setup.db;
    dispose = setup.dispose;
  });

  after(async () => {
    await teardownMailReadApiDb(db, dispose);
  });

  it("returns accessible mailboxes for authenticated mail user", async () => {
    const res = await handleGetAccessibleMailboxes(new Request("http://localhost/api/mail/mailboxes/accessible"), {
      requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { items: Array<{ id: string }> };
    assert.ok(Array.isArray(json.items));
    assert.ok(json.items.length > 0);
  });

  it("denies users without mail access", async () => {
    const res = await handleGetAccessibleMailboxes(new Request("http://localhost/api/mail/mailboxes/accessible"), {
      requireMailActor: makeRequireMailActor(
        db,
        actor(SEED_IDS.staffA, { mailAccessEnabled: false }),
      ),
    });
    assert.equal(res.status, 403);
  });

  it("does not grant unrelated mailboxes to super_admin alone", async () => {
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("super-admin-hidden"),
      mailboxType: "shared",
    });
    const res = await handleGetAccessibleMailboxes(new Request("http://localhost/api/mail/mailboxes/accessible"), {
      requireMailActor: makeRequireMailActor(
        db,
        actor(SEED_IDS.staffB, { adminGrants: ["super_admin"] }),
      ),
    });
    const json = (await res.json()) as { items: Array<{ id: string }> };
    assert.ok(!json.items.some((item) => item.id === mailbox.id));
  });

  it("returns global_read-only mailbox for explicit global_mail_read", async () => {
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("global-only-api"),
      mailboxType: "shared",
    });
    const res = await handleGetAccessibleMailboxes(new Request("http://localhost/api/mail/mailboxes/accessible"), {
      requireMailActor: makeRequireMailActor(
        db,
        actor(SEED_IDS.staffB, { adminGrants: ["global_mail_read"] }),
      ),
    });
    const json = (await res.json()) as {
      items: Array<{
        id: string;
        accessMode: string;
        permissions: { canRead: boolean; canReply: boolean; canSend: boolean };
      }>;
    };
    const row = json.items.find((item) => item.id === mailbox.id);
    assert.ok(row);
    assert.equal(row.accessMode, "global_read");
    assert.equal(row.permissions.canRead, true);
    assert.equal(row.permissions.canReply, false);
    assert.equal(row.permissions.canSend, false);
  });

  it("preserves member permissions when actor also has global_mail_read", async () => {
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("member-global-api"),
      mailboxType: "shared",
    });
    await addMailboxMember(db, {
      id: "mail-read-api-member-global-api",
      mailboxId: mailbox.id,
      userId: SEED_IDS.staffA,
      canReply: true,
      canSend: true,
    });

    const res = await handleGetAccessibleMailboxes(new Request("http://localhost/api/mail/mailboxes/accessible"), {
      requireMailActor: makeRequireMailActor(
        db,
        actor(SEED_IDS.staffA, { adminGrants: ["global_mail_read"] }),
      ),
    });
    const json = (await res.json()) as {
      items: Array<{
        id: string;
        accessMode: string;
        permissions: { canRead: boolean; canReply: boolean; canSend: boolean };
      }>;
    };
    const row = json.items.find((item) => item.id === mailbox.id);
    assert.ok(row);
    assert.equal(row.accessMode, "member");
    assert.equal(row.permissions.canReply, true);
    assert.equal(row.permissions.canSend, true);
  });
});
