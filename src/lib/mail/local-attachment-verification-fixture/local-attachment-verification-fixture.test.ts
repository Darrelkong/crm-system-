import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { like } from "drizzle-orm";
import * as schema from "../../../../drizzle/schema";
import {
  LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_PREFIX,
  LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS,
  LOCAL_MAIL_ATTACHMENT_VERIFY_OPT_IN_ENV,
} from "@/lib/mail/local-attachment-verification-fixture/constants";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  assertLocalMailAttachmentVerifyFixtureAllowed,
  LocalMailAttachmentVerifyFixtureGuardError,
} from "@/lib/mail/local-attachment-verification-fixture/guard";
import {
  cleanupLocalAttachmentVerificationFixtures,
  connectLocalAttachmentVerificationFixtureEnv,
  setupLocalAttachmentVerificationFixtures,
  verifyLocalAttachmentDownloadApi,
  verifyLocalAttachmentVerificationFixtures,
} from "@/lib/mail/local-attachment-verification-fixture/service";

describe("LOCAL_MAIL_ATTACHMENT_VERIFY_2H5B fixture", () => {
  before(() => {
    process.env[LOCAL_MAIL_ATTACHMENT_VERIFY_OPT_IN_ENV] = "1";
  });

  it("rejects without opt-in env", () => {
    delete process.env[LOCAL_MAIL_ATTACHMENT_VERIFY_OPT_IN_ENV];
    assert.throws(
      () =>
        assertLocalMailAttachmentVerifyFixtureAllowed({
          local: true,
          remote: false,
        }),
      LocalMailAttachmentVerifyFixtureGuardError,
    );
    process.env[LOCAL_MAIL_ATTACHMENT_VERIFY_OPT_IN_ENV] = "1";
  });

  it("rejects remote target", () => {
    assert.throws(
      () =>
        assertLocalMailAttachmentVerifyFixtureAllowed({
          local: true,
          remote: true,
        }),
      LocalMailAttachmentVerifyFixtureGuardError,
    );
  });

  it("setup is idempotent and verify passes", async () => {
    const { db, attachmentsBucket, dispose } =
      await connectLocalAttachmentVerificationFixtureEnv({ local: true, remote: false });
    try {
      const first = await setupLocalAttachmentVerificationFixtures(db, attachmentsBucket);
      const second = await setupLocalAttachmentVerificationFixtures(db, attachmentsBucket);
      assert.equal(first.attachmentCount, second.attachmentCount);
      assert.ok(first.r2ObjectCount > 0);

      const verified = await verifyLocalAttachmentVerificationFixtures(
        db,
        attachmentsBucket,
      );
      assert.equal(
        (verified.attachmentCount as number) >= 13,
        true,
        "expected fixture attachments",
      );

      const api = await verifyLocalAttachmentDownloadApi(db, attachmentsBucket);
      assert.equal(api.authorizedStatus, 200);
      assert.equal(api.unauthorizedStatus, 404);
      assert.equal(api.authorizedBytesMatchPdf, true);
    } finally {
      await cleanupLocalAttachmentVerificationFixtures(db, attachmentsBucket);
      await dispose();
    }
  });

  it("cleanup removes only fixture namespace", async () => {
    const { db, attachmentsBucket, dispose } =
      await connectLocalAttachmentVerificationFixtureEnv({ local: true, remote: false });
    try {
      await setupLocalAttachmentVerificationFixtures(db, attachmentsBucket);
      const removed = await cleanupLocalAttachmentVerificationFixtures(
        db,
        attachmentsBucket,
      );
      assert.ok(removed.deletedMessages > 0);
      assert.ok(removed.deletedStoredFiles > 0);

      const attachments = await db
        .select({ id: schema.mailMessageAttachments.id })
        .from(schema.mailMessageAttachments)
        .where(like(schema.mailMessageAttachments.id, `${LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_PREFIX}%`));
      assert.equal(attachments.length, 0);
    } finally {
      await dispose();
    }
  });

  it("cleanup succeeds when read states exist on fixture messages", async () => {
    const { db, attachmentsBucket, dispose } =
      await connectLocalAttachmentVerificationFixtureEnv({ local: true, remote: false });
    try {
      await setupLocalAttachmentVerificationFixtures(db, attachmentsBucket);
      const messageId = LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS.cleanPdf;
      const now = new Date().toISOString();
      await db.insert(schema.mailMessageReadStates).values({
        messageId,
        userId: SEED_IDS.staffA,
        isRead: 1,
        readAt: now,
        isImportantPersonal: 0,
        updatedAt: now,
      });

      await cleanupLocalAttachmentVerificationFixtures(db, attachmentsBucket);

      const remainingMessages = await db
        .select({ id: schema.mailMessages.id })
        .from(schema.mailMessages)
        .where(like(schema.mailMessages.id, `${LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_PREFIX}%`));
      assert.equal(remainingMessages.length, 0);

      const remainingThreads = await db
        .select({ id: schema.mailThreads.id })
        .from(schema.mailThreads)
        .where(like(schema.mailThreads.id, `${LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_PREFIX}%`));
      assert.equal(remainingThreads.length, 0);
    } finally {
      await dispose();
    }
  });

  it("supports setup verify cleanup setup verify idempotency", async () => {
    const { db, attachmentsBucket, dispose } =
      await connectLocalAttachmentVerificationFixtureEnv({ local: true, remote: false });
    try {
      await setupLocalAttachmentVerificationFixtures(db, attachmentsBucket);
      const firstVerify = await verifyLocalAttachmentVerificationFixtures(
        db,
        attachmentsBucket,
      );
      assert.ok((firstVerify.attachmentCount as number) >= 13);

      await setupLocalAttachmentVerificationFixtures(db, attachmentsBucket);
      const secondVerify = await verifyLocalAttachmentVerificationFixtures(
        db,
        attachmentsBucket,
      );
      assert.equal(firstVerify.attachmentCount, secondVerify.attachmentCount);

      await cleanupLocalAttachmentVerificationFixtures(db, attachmentsBucket);
      const afterCleanup = await db
        .select({ id: schema.mailMessageAttachments.id })
        .from(schema.mailMessageAttachments)
        .where(like(schema.mailMessageAttachments.id, `${LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_PREFIX}%`));
      assert.equal(afterCleanup.length, 0);

      await setupLocalAttachmentVerificationFixtures(db, attachmentsBucket);
      const thirdVerify = await verifyLocalAttachmentVerificationFixtures(
        db,
        attachmentsBucket,
      );
      assert.equal(firstVerify.attachmentCount, thirdVerify.attachmentCount);
    } finally {
      await cleanupLocalAttachmentVerificationFixtures(db, attachmentsBucket);
      await dispose();
    }
  });

  it("uses isolated namespace prefix", () => {
    assert.match(
      LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_PREFIX,
      /LOCAL_MAIL_ATTACHMENT_VERIFY_2H5B/,
    );
  });
});
