#!/usr/bin/env tsx
import {
  cleanupLocalAttachmentVerificationFixtures,
  connectLocalAttachmentVerificationFixtureEnv,
  setupLocalAttachmentVerificationFixtures,
  verifyLocalAttachmentDownloadApi,
  verifyLocalAttachmentVerificationFixtures,
} from "../src/lib/mail/local-attachment-verification-fixture/service";
import {
  LOCAL_MAIL_ATTACHMENT_VERIFY_D1_HINT,
  parseLocalMailAttachmentVerifyCliTarget,
} from "../src/lib/mail/local-attachment-verification-fixture/guard";
import { LOCAL_MAIL_ATTACHMENT_VERIFY_OPT_IN_ENV } from "../src/lib/mail/local-attachment-verification-fixture/constants";

async function main() {
  const argv = process.argv.slice(2);
  const command = argv.find((arg) => !arg.startsWith("-")) ?? "help";
  const target = parseLocalMailAttachmentVerifyCliTarget(argv);

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(`Local Mail Attachment Verification Fixture (Phase 2H-5B)

Target: ${LOCAL_MAIL_ATTACHMENT_VERIFY_D1_HINT}
Requires: ${LOCAL_MAIL_ATTACHMENT_VERIFY_OPT_IN_ENV}=1 and --local

Commands:
  setup    Create deterministic LOCAL_MAIL_ATTACHMENT_VERIFY_2H5B fixtures (D1 + local R2)
  cleanup  Remove fixture namespace D1 records and tracked local R2 objects only
  verify   Read-only fixture + download API validation

Examples:
  CRM_ALLOW_LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE=1 tsx scripts/mail-local-attachment-verification-fixture.ts setup --local
  CRM_ALLOW_LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE=1 tsx scripts/mail-local-attachment-verification-fixture.ts cleanup --local
  CRM_ALLOW_LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE=1 tsx scripts/mail-local-attachment-verification-fixture.ts verify --local
`);
    return;
  }

  const { db, attachmentsBucket, dispose } =
    await connectLocalAttachmentVerificationFixtureEnv(target);
  try {
    if (command === "setup") {
      const result = await setupLocalAttachmentVerificationFixtures(
        db,
        attachmentsBucket,
      );
      const verified = await verifyLocalAttachmentVerificationFixtures(
        db,
        attachmentsBucket,
      );
      console.log(
        JSON.stringify(
          {
            ok: true,
            command: "setup",
            target: "local",
            ...result,
            verified,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (command === "cleanup") {
      const removed = await cleanupLocalAttachmentVerificationFixtures(
        db,
        attachmentsBucket,
      );
      console.log(
        JSON.stringify(
          {
            ok: true,
            command: "cleanup",
            target: "local",
            ...removed,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (command === "verify") {
      const verified = await verifyLocalAttachmentVerificationFixtures(
        db,
        attachmentsBucket,
      );
      const api = await verifyLocalAttachmentDownloadApi(db, attachmentsBucket);
      console.log(
        JSON.stringify(
          {
            ok: true,
            command: "verify",
            target: "local",
            verified,
            api,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.error(`Unknown command: ${command}`);
    process.exit(2);
  } finally {
    await dispose();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        code:
          error && typeof error === "object" && "code" in error
            ? String((error as { code: unknown }).code)
            : "UNKNOWN",
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
