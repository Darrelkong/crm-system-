import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { handleGetMailMessageDetail } from "@/app/api/mail/messages/[id]/route";
import {
  actor,
  makeRequireMailActor,
  type TestDb,
} from "@/app/api/mail/mail-read-route-test-helpers";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS,
  LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_ACTORS,
  LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS,
  LOCAL_MAIL_ATTACHMENT_VERIFY_OPT_IN_ENV,
} from "@/lib/mail/local-attachment-verification-fixture/constants";
import {
  cleanupLocalAttachmentVerificationFixtures,
  connectLocalAttachmentVerificationFixtureEnv,
  setupLocalAttachmentVerificationFixtures,
} from "@/lib/mail/local-attachment-verification-fixture/service";

describe("mail attachment download availability API contract", () => {
  before(() => {
    process.env[LOCAL_MAIL_ATTACHMENT_VERIFY_OPT_IN_ENV] = "1";
  });

  it("returns explicit download and preview capability for direct attachments", async () => {
    const { db, attachmentsBucket, dispose } =
      await connectLocalAttachmentVerificationFixtureEnv({ local: true, remote: false });
    try {
      await cleanupLocalAttachmentVerificationFixtures(db, attachmentsBucket);
      await setupLocalAttachmentVerificationFixtures(db, attachmentsBucket);
      const staffA = actor(LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_ACTORS.staffA);

      async function detailFor(messageId: string) {
        const res = await handleGetMailMessageDetail(
          new Request(`http://localhost/api/mail/messages/${messageId}?folder=inbox`),
          messageId,
          { requireMailActor: makeRequireMailActor(db as TestDb, staffA) },
        );
        assert.equal(res.status, 200);
        return (await res.json()) as {
          item: { attachments: Array<Record<string, unknown>> };
        };
      }

      const cleanPdf = await detailFor(
        LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS.cleanPdf,
      );
      assert.equal(
        cleanPdf.item.attachments.find(
          (row) => row.id === LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.cleanPdf,
        )?.downloadAvailable,
        true,
      );
      assert.equal(
        cleanPdf.item.attachments.find(
          (row) => row.id === LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.cleanPdf,
        )?.previewable,
        true,
      );
      assert.equal(
        cleanPdf.item.attachments.find(
          (row) => row.id === LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.cleanPdf,
        )?.previewType,
        "pdf",
      );

      const unscanned = await detailFor(
        LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS.unscanned,
      );
      assert.equal(
        unscanned.item.attachments.find(
          (row) =>
            row.id === LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.unscanned,
        )?.downloadAvailable,
        true,
      );

      const secureFile = await detailFor(
        LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS.secureFile,
      );
      assert.equal(
        secureFile.item.attachments.find(
          (row) =>
            row.id === LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.secureFile,
        )?.downloadAvailable,
        false,
      );

      const missingR2 = await detailFor(
        LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS.missingR2,
      );
      assert.equal(
        missingR2.item.attachments.find(
          (row) =>
            row.id === LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.missingR2,
        )?.downloadAvailable,
        true,
      );

      for (const attachment of cleanPdf.item.attachments) {
        assert.equal("securityScanStatus" in attachment, false);
        assert.equal("security_scan_status" in attachment, false);
        assert.equal("storageKey" in attachment, false);
        assert.equal("storedFileId" in attachment, false);
      }

      await cleanupLocalAttachmentVerificationFixtures(db, attachmentsBucket);
    } finally {
      await dispose();
    }
  });
});
