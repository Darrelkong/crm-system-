import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  actor,
  adminActor,
  setupMailReadApiDb,
  teardownMailReadApiDb,
  type TestDb,
} from "@/app/api/mail/mail-read-route-test-helpers";
import { listOutboxPage } from "@/lib/mail/outbox-service";
import { MailServiceError } from "@/lib/mail/errors";

describe("Outbox aggregate scope", () => {
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

  it("allows CRM Admin All scope", async () => {
    const page = await listOutboxPage(db, adminActor, { scope: "all" });
    assert.ok(Array.isArray(page.items));
    assert.ok(page.items.every((item) => item.sourceMailbox));
  });

  it("denies Staff All scope even with global_mail_read", async () => {
    await assert.rejects(
      listOutboxPage(
        db,
        actor(SEED_IDS.staffA, { adminGrants: ["global_mail_read"] }),
        { scope: "all" },
      ),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 403,
    );
  });
});
