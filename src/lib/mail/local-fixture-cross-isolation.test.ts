import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  LOCAL_MAIL_ATTACHMENT_VERIFY_OPT_IN_ENV,
} from "@/lib/mail/local-attachment-verification-fixture/constants";
import {
  cleanupLocalAttachmentVerificationFixtures,
  connectLocalAttachmentVerificationFixtureEnv,
  setupLocalAttachmentVerificationFixtures,
  verifyLocalAttachmentVerificationFixtures,
} from "@/lib/mail/local-attachment-verification-fixture/service";
import {
  LOCAL_MAIL_CRM_VERIFY_OPT_IN_ENV,
} from "@/lib/mail/local-crm-verification-fixture/constants";
import {
  cleanupLocalMailCrmVerificationFixtures,
  connectLocalCrmVerificationFixtureDb,
  setupLocalMailCrmVerificationFixtures,
  verifyLocalMailCrmVerificationFixtures,
} from "@/lib/mail/local-crm-verification-fixture/service";
import { parseLocalMailCrmVerifyCliTarget } from "@/lib/mail/local-crm-verification-fixture/guard";
import {
  LOCAL_MAIL_VERIFY_OPT_IN_ENV,
} from "@/lib/mail/local-verification-fixture/constants";
import {
  cleanupLocalMailVerificationFixtures,
  connectLocalVerificationFixtureDb,
  setupLocalMailVerificationFixtures,
  verifyLocalMailVerificationFixtures,
} from "@/lib/mail/local-verification-fixture/service";
import {
  LOCAL_MAIL_REPLY_VERIFY_OPT_IN_ENV,
} from "@/lib/mail/local-reply-verification-fixture/constants";
import {
  cleanupLocalMailReplyVerificationFixtures,
  connectLocalMailReplyVerificationFixtureDb,
  setupLocalMailReplyVerificationFixtures,
  verifyLocalMailReplyVerificationFixtures,
} from "@/lib/mail/local-reply-verification-fixture/service";
import { parseLocalMailVerifyCliTarget } from "@/lib/mail/local-verification-fixture/guard";

describe("local mail fixture cross-namespace isolation", () => {
  before(() => {
    process.env[LOCAL_MAIL_VERIFY_OPT_IN_ENV] = "1";
    process.env[LOCAL_MAIL_CRM_VERIFY_OPT_IN_ENV] = "1";
    process.env[LOCAL_MAIL_ATTACHMENT_VERIFY_OPT_IN_ENV] = "1";
    process.env[LOCAL_MAIL_REPLY_VERIFY_OPT_IN_ENV] = "1";
  });

  it("preserves 2H3D5B and 4B2 when only 2H5B is cleaned up", async () => {
    const connection3d5b = await connectLocalVerificationFixtureDb(
      parseLocalMailVerifyCliTarget(["--local"]),
    );
    const connection4b2 = await connectLocalCrmVerificationFixtureDb(
      parseLocalMailCrmVerifyCliTarget(["--local"]),
    );
    const connection5b = await connectLocalAttachmentVerificationFixtureEnv({
      local: true,
      remote: false,
    });
    try {
      await setupLocalMailVerificationFixtures(connection3d5b.db);
      await setupLocalMailCrmVerificationFixtures(connection4b2.db);
      await setupLocalAttachmentVerificationFixtures(
        connection5b.db,
        connection5b.attachmentsBucket,
      );

      const before3d5b = await verifyLocalMailVerificationFixtures(connection3d5b.db);
      const before4b2 = await verifyLocalMailCrmVerificationFixtures(connection4b2.db);

      await cleanupLocalAttachmentVerificationFixtures(
        connection5b.db,
        connection5b.attachmentsBucket,
      );

      const after3d5b = await verifyLocalMailVerificationFixtures(connection3d5b.db);
      const after4b2 = await verifyLocalMailCrmVerificationFixtures(connection4b2.db);
      assert.equal(after3d5b.messageCount, before3d5b.messageCount);
      assert.equal(after4b2.messageCount, before4b2.messageCount);

      await setupLocalAttachmentVerificationFixtures(
        connection5b.db,
        connection5b.attachmentsBucket,
      );
      const restored5b = await verifyLocalAttachmentVerificationFixtures(
        connection5b.db,
        connection5b.attachmentsBucket,
      );
      assert.ok((restored5b.attachmentCount as number) >= 13);
    } finally {
      await cleanupLocalAttachmentVerificationFixtures(
        connection5b.db,
        connection5b.attachmentsBucket,
      );
      await cleanupLocalMailCrmVerificationFixtures(connection4b2.db);
      await cleanupLocalMailVerificationFixtures(connection3d5b.db);
      await connection5b.dispose();
      await connection4b2.dispose();
      await connection3d5b.dispose();
    }
  });

  it("preserves 2H3D5B and 2H5B when only 4B2 is cleaned up", async () => {
    const connection3d5b = await connectLocalVerificationFixtureDb(
      parseLocalMailVerifyCliTarget(["--local"]),
    );
    const connection4b2 = await connectLocalCrmVerificationFixtureDb(
      parseLocalMailCrmVerifyCliTarget(["--local"]),
    );
    const connection5b = await connectLocalAttachmentVerificationFixtureEnv({
      local: true,
      remote: false,
    });
    try {
      await setupLocalMailVerificationFixtures(connection3d5b.db);
      await setupLocalMailCrmVerificationFixtures(connection4b2.db);
      await setupLocalAttachmentVerificationFixtures(
        connection5b.db,
        connection5b.attachmentsBucket,
      );

      const before3d5b = await verifyLocalMailVerificationFixtures(connection3d5b.db);
      const before5b = await verifyLocalAttachmentVerificationFixtures(
        connection5b.db,
        connection5b.attachmentsBucket,
      );

      await cleanupLocalMailCrmVerificationFixtures(connection4b2.db);

      const after3d5b = await verifyLocalMailVerificationFixtures(connection3d5b.db);
      const after5b = await verifyLocalAttachmentVerificationFixtures(
        connection5b.db,
        connection5b.attachmentsBucket,
      );
      assert.equal(after3d5b.messageCount, before3d5b.messageCount);
      assert.equal(after5b.attachmentCount, before5b.attachmentCount);

      await setupLocalMailCrmVerificationFixtures(connection4b2.db);
      const restored4b2 = await verifyLocalMailCrmVerificationFixtures(connection4b2.db);
      assert.ok(restored4b2.messageCount > 0);
    } finally {
      await cleanupLocalAttachmentVerificationFixtures(
        connection5b.db,
        connection5b.attachmentsBucket,
      );
      await cleanupLocalMailCrmVerificationFixtures(connection4b2.db);
      await cleanupLocalMailVerificationFixtures(connection3d5b.db);
      await connection5b.dispose();
      await connection4b2.dispose();
      await connection3d5b.dispose();
    }
  });

  it("preserves 2H3D5B, 4B2, and 2H5B when only 2H6E is cleaned up", async () => {
    const connection3d5b = await connectLocalVerificationFixtureDb(
      parseLocalMailVerifyCliTarget(["--local"]),
    );
    const connection4b2 = await connectLocalCrmVerificationFixtureDb(
      parseLocalMailCrmVerifyCliTarget(["--local"]),
    );
    const connection5b = await connectLocalAttachmentVerificationFixtureEnv({
      local: true,
      remote: false,
    });
    const connection6e = await connectLocalMailReplyVerificationFixtureDb({
      local: true,
      remote: false,
    });
    try {
      await setupLocalMailVerificationFixtures(connection3d5b.db);
      await setupLocalMailCrmVerificationFixtures(connection4b2.db);
      await setupLocalAttachmentVerificationFixtures(
        connection5b.db,
        connection5b.attachmentsBucket,
      );
      await setupLocalMailReplyVerificationFixtures(connection6e.db);

      const before3d5b = await verifyLocalMailVerificationFixtures(connection3d5b.db);
      const before4b2 = await verifyLocalMailCrmVerificationFixtures(connection4b2.db);
      const before5b = await verifyLocalAttachmentVerificationFixtures(
        connection5b.db,
        connection5b.attachmentsBucket,
      );

      await cleanupLocalMailReplyVerificationFixtures(connection6e.db);

      const after3d5b = await verifyLocalMailVerificationFixtures(connection3d5b.db);
      const after4b2 = await verifyLocalMailCrmVerificationFixtures(connection4b2.db);
      const after5b = await verifyLocalAttachmentVerificationFixtures(
        connection5b.db,
        connection5b.attachmentsBucket,
      );
      assert.equal(after3d5b.messageCount, before3d5b.messageCount);
      assert.equal(after4b2.messageCount, before4b2.messageCount);
      assert.equal(after5b.attachmentCount, before5b.attachmentCount);

      await setupLocalMailReplyVerificationFixtures(connection6e.db);
      const restored6e = await verifyLocalMailReplyVerificationFixtures(connection6e.db);
      assert.equal(restored6e.messageCount, 9);
    } finally {
      await cleanupLocalMailReplyVerificationFixtures(connection6e.db);
      await cleanupLocalAttachmentVerificationFixtures(
        connection5b.db,
        connection5b.attachmentsBucket,
      );
      await cleanupLocalMailCrmVerificationFixtures(connection4b2.db);
      await cleanupLocalMailVerificationFixtures(connection3d5b.db);
      await connection6e.dispose();
      await connection5b.dispose();
      await connection4b2.dispose();
      await connection3d5b.dispose();
    }
  });
});
