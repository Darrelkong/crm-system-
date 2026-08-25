import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
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
});
