import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { handleGetMailAttachmentDownload } from "@/app/api/mail/attachments/[attachmentId]/download/route";
import { makeRequireMailActor, type TestDb } from "@/app/api/mail/mail-read-route-test-helpers";
import {
  FIXTURE_ATTACHMENT_BYTES,
  hashFixtureBytes,
} from "@/lib/mail/local-attachment-verification-fixture/bytes";
import {
  LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS,
  LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_ACTORS,
  LOCAL_MAIL_ATTACHMENT_VERIFY_OPT_IN_ENV,
} from "@/lib/mail/local-attachment-verification-fixture/constants";
import {
  cleanupLocalAttachmentVerificationFixtures,
  connectLocalAttachmentVerificationFixtureEnv,
  setupLocalAttachmentVerificationFixtures,
} from "@/lib/mail/local-attachment-verification-fixture/service";
import { R2MailAttachmentByteReader } from "@/lib/mail/mail-attachment-byte-reader";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { SEED_IDS } from "@/lib/constants/seed-ids";

function mailActor(userId: string): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole: userId === SEED_IDS.admin ? "admin" : "staff",
    mailAccessEnabled: true,
    adminGrants: [],
    audit: {
      ipAddress: "127.0.0.1",
      userAgent: "mail-attachment-download-integration",
    },
  };
}

describe("mail attachment download local D1 + R2 integration", () => {
  before(() => {
    process.env[LOCAL_MAIL_ATTACHMENT_VERIFY_OPT_IN_ENV] = "1";
  });

  it("downloads fixture bytes through route with real local ATTACHMENTS binding", async () => {
    const { db, attachmentsBucket, dispose } =
      await connectLocalAttachmentVerificationFixtureEnv({ local: true, remote: false });
    try {
      await cleanupLocalAttachmentVerificationFixtures(db, attachmentsBucket);
      await setupLocalAttachmentVerificationFixtures(db, attachmentsBucket);

      const attachmentId = LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.cleanPdf;
      const res = await handleGetMailAttachmentDownload(
        new Request(
          `http://localhost/api/mail/attachments/${attachmentId}/download?folder=inbox`,
        ),
        attachmentId,
        {
          requireMailActor: makeRequireMailActor(
            db as TestDb,
            mailActor(LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_ACTORS.staffA),
          ),
          createByteReader: () => new R2MailAttachmentByteReader(attachmentsBucket),
        },
      );

      assert.equal(res.status, 200);
      const body = new Uint8Array(await res.arrayBuffer());
      assert.ok(Buffer.from(body).equals(Buffer.from(FIXTURE_ATTACHMENT_BYTES.cleanPdf)));
      assert.equal(
        hashFixtureBytes(body),
        hashFixtureBytes(FIXTURE_ATTACHMENT_BYTES.cleanPdf),
      );
      assert.equal(res.headers.get("Cache-Control"), "private, no-store");
      assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");

      await cleanupLocalAttachmentVerificationFixtures(db, attachmentsBucket);
    } finally {
      await dispose();
    }
  });

  it("returns 404 for cross-mailbox unauthorized fixture attachment", async () => {
    const { db, attachmentsBucket, dispose } =
      await connectLocalAttachmentVerificationFixtureEnv({ local: true, remote: false });
    try {
      await cleanupLocalAttachmentVerificationFixtures(db, attachmentsBucket);
      await setupLocalAttachmentVerificationFixtures(db, attachmentsBucket);

      const attachmentId =
        LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.unauthorizedMailbox;
      const res = await handleGetMailAttachmentDownload(
        new Request(
          `http://localhost/api/mail/attachments/${attachmentId}/download?folder=inbox`,
        ),
        attachmentId,
        {
          requireMailActor: makeRequireMailActor(
            db as TestDb,
            mailActor(LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_ACTORS.staffB),
          ),
          createByteReader: () => new R2MailAttachmentByteReader(attachmentsBucket),
        },
      );
      assert.equal(res.status, 404);

      await cleanupLocalAttachmentVerificationFixtures(db, attachmentsBucket);
    } finally {
      await dispose();
    }
  });
});
