import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { inArray } from "drizzle-orm";
import * as schema from "../../../../drizzle/schema";
import {
  LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX,
  LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS,
  LOCAL_MAIL_REPLY_VERIFY_OPT_IN_ENV,
} from "@/lib/mail/local-reply-verification-fixture/constants";
import {
  assertLocalMailReplyVerifyFixtureAllowed,
  LocalMailReplyVerifyFixtureGuardError,
  parseLocalMailReplyVerifyCliTarget,
} from "@/lib/mail/local-reply-verification-fixture/guard";
import {
  cleanupLocalMailReplyVerificationFixtures,
  connectLocalMailReplyVerificationFixtureDb,
  listFixtureMessagesMissingBodies,
  setupLocalMailReplyVerificationFixtures,
  verifyLocalMailReplyComposeSeedApi,
  verifyLocalMailReplyVerificationFixtures,
} from "@/lib/mail/local-reply-verification-fixture/service";

describe("LOCAL_MAIL_REPLY_VERIFY_2H6E fixture", () => {
  before(() => {
    process.env[LOCAL_MAIL_REPLY_VERIFY_OPT_IN_ENV] = "1";
  });

  it("rejects without opt-in env", () => {
    delete process.env[LOCAL_MAIL_REPLY_VERIFY_OPT_IN_ENV];
    assert.throws(
      () =>
        assertLocalMailReplyVerifyFixtureAllowed(
          parseLocalMailReplyVerifyCliTarget(["--local"]),
        ),
      LocalMailReplyVerifyFixtureGuardError,
    );
    process.env[LOCAL_MAIL_REPLY_VERIFY_OPT_IN_ENV] = "1";
  });

  it("rejects remote target", () => {
    assert.throws(
      () =>
        assertLocalMailReplyVerifyFixtureAllowed({
          local: true,
          remote: true,
        }),
      LocalMailReplyVerifyFixtureGuardError,
    );
  });

  it("setup is idempotent and verify passes", async () => {
    const { db, dispose } = await connectLocalMailReplyVerificationFixtureDb({
      local: true,
      remote: false,
    });
    try {
      const first = await setupLocalMailReplyVerificationFixtures(db);
      const second = await setupLocalMailReplyVerificationFixtures(db);
      assert.equal(first.messageIds.inboundReply, second.messageIds.inboundReply);

      const verified = await verifyLocalMailReplyVerificationFixtures(db);
      assert.equal(verified.messageCount, 9);
      assert.equal(verified.fixtureBodiesComplete, true);
      assert.equal(verified.listDetailIdsMatch, true);
      assert.equal(verified.messagesMissingBodies.length, 0);
      assert.equal(verified.staffACanReadInboundReply, true);
      assert.equal(verified.staffBCanReadSharedReply, true);
      assert.equal(verified.staffBCannotReadStaffAOnly, true);

      const seedApi = await verifyLocalMailReplyComposeSeedApi(db);
      assert.equal(
        seedApi.every((result) => result.ok),
        true,
        `seed API failures: ${JSON.stringify(seedApi.filter((r) => !r.ok))}`,
      );
    } finally {
      await cleanupLocalMailReplyVerificationFixtures(db);
      await dispose();
    }
  });

  it("cleanup removes only namespace rows", async () => {
    const { db, dispose } = await connectLocalMailReplyVerificationFixtureDb({
      local: true,
      remote: false,
    });
    try {
      await setupLocalMailReplyVerificationFixtures(db);
      const removed = await cleanupLocalMailReplyVerificationFixtures(db);
      assert.equal(removed.deletedMessageCount, 9);

      const verified = await verifyLocalMailReplyVerificationFixtures(db);
      assert.equal(verified.messageCount, 0);
    } finally {
      await dispose();
    }
  });

  it("sequential setup verify cleanup setup verify", async () => {
    const { db, dispose } = await connectLocalMailReplyVerificationFixtureDb({
      local: true,
      remote: false,
    });
    try {
      await setupLocalMailReplyVerificationFixtures(db);
      let verified = await verifyLocalMailReplyVerificationFixtures(db);
      assert.equal(verified.messageCount, 9);

      await setupLocalMailReplyVerificationFixtures(db);
      verified = await verifyLocalMailReplyVerificationFixtures(db);
      assert.equal(verified.messageCount, 9);

      await cleanupLocalMailReplyVerificationFixtures(db);
      verified = await verifyLocalMailReplyVerificationFixtures(db);
      assert.equal(verified.messageCount, 0);

      await setupLocalMailReplyVerificationFixtures(db);
      verified = await verifyLocalMailReplyVerificationFixtures(db);
      assert.equal(verified.messageCount, 9);
      assert.ok(
        verified.messageIds.every((id) => id.startsWith(LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX)),
      );
      assert.ok(
        verified.messageIds.includes(LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.inboundReply),
      );
    } finally {
      await cleanupLocalMailReplyVerificationFixtures(db);
      await dispose();
    }
  });

  it("cleanup twice is idempotent and preserves unrelated mail rows", async () => {
    const { db, dispose } = await connectLocalMailReplyVerificationFixtureDb({
      local: true,
      remote: false,
    });
    try {
      await setupLocalMailReplyVerificationFixtures(db);
      const first = await cleanupLocalMailReplyVerificationFixtures(db);
      assert.equal(first.deletedMessageCount, 9);
      assert.equal((await listFixtureMessagesMissingBodies(db)).length, 0);

      const second = await cleanupLocalMailReplyVerificationFixtures(db);
      assert.equal(second.deletedMessageCount, 0);
      assert.equal(second.deletedMailboxCount, 0);

      let verified = await verifyLocalMailReplyVerificationFixtures(db);
      assert.equal(verified.messageCount, 0);
      assert.equal(verified.fixtureBodiesComplete, true);
      assert.equal(verified.messagesMissingBodies.length, 0);

      await setupLocalMailReplyVerificationFixtures(db);
      verified = await verifyLocalMailReplyVerificationFixtures(db);
      assert.equal(verified.messageCount, 9);
      assert.equal(verified.fixtureBodiesComplete, true);
      assert.equal(verified.listDetailIdsMatch, true);
      assert.equal(verified.messagesMissingBodies.length, 0);
    } finally {
      await cleanupLocalMailReplyVerificationFixtures(db);
      await dispose();
    }
  });

  it("setup repairs fixture messages missing canonical bodies", async () => {
    const { db, dispose } = await connectLocalMailReplyVerificationFixtureDb({
      local: true,
      remote: false,
    });
    try {
      await setupLocalMailReplyVerificationFixtures(db);
      await db
        .delete(schema.mailMessageBodies)
        .where(
          inArray(
            schema.mailMessageBodies.messageId,
            Object.values(LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS),
          ),
        );

      const missingBefore = await listFixtureMessagesMissingBodies(db);
      assert.equal(missingBefore.length, 9);

      let verified = await verifyLocalMailReplyVerificationFixtures(db);
      assert.equal(verified.fixtureBodiesComplete, false);
      assert.equal(verified.messagesMissingBodies.length, 9);

      await setupLocalMailReplyVerificationFixtures(db);
      const missingAfter = await listFixtureMessagesMissingBodies(db);
      assert.equal(missingAfter.length, 0);

      verified = await verifyLocalMailReplyVerificationFixtures(db);
      assert.equal(verified.fixtureBodiesComplete, true);
      assert.equal(verified.listDetailIdsMatch, true);
      assert.equal(verified.staffACanReadInboundReply, true);
    } finally {
      await cleanupLocalMailReplyVerificationFixtures(db);
      await dispose();
    }
  });
});
