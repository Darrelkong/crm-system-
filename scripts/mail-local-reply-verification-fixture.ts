#!/usr/bin/env tsx
import {
  cleanupLocalMailReplyVerificationFixtures,
  connectLocalMailReplyVerificationFixtureDb,
  setupLocalMailReplyVerificationFixtures,
  verifyLocalMailReplyComposeSeedApi,
  verifyLocalMailReplyVerificationFixtures,
} from "../src/lib/mail/local-reply-verification-fixture/service";
import {
  LOCAL_MAIL_REPLY_VERIFY_D1_HINT,
  parseLocalMailReplyVerifyCliTarget,
} from "../src/lib/mail/local-reply-verification-fixture/guard";
import { LOCAL_MAIL_REPLY_VERIFY_OPT_IN_ENV } from "../src/lib/mail/local-reply-verification-fixture/constants";

async function main() {
  const argv = process.argv.slice(2);
  const command = argv.find((arg) => !arg.startsWith("-")) ?? "help";
  const target = parseLocalMailReplyVerifyCliTarget(argv);

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(`Local Mail Reply Verification Fixture (Phase 2H-6E)

Target: ${LOCAL_MAIL_REPLY_VERIFY_D1_HINT}
Requires: ${LOCAL_MAIL_REPLY_VERIFY_OPT_IN_ENV}=1 and --local

Commands:
  setup    Create deterministic LOCAL_MAIL_REPLY_VERIFY_2H6E fixtures
  cleanup  Remove fixture namespace records only
  verify   Read-only fixture + compose seed API validation

Examples:
  CRM_ALLOW_LOCAL_MAIL_REPLY_VERIFY_FIXTURE=1 tsx scripts/mail-local-reply-verification-fixture.ts setup --local
  CRM_ALLOW_LOCAL_MAIL_REPLY_VERIFY_FIXTURE=1 tsx scripts/mail-local-reply-verification-fixture.ts cleanup --local
  CRM_ALLOW_LOCAL_MAIL_REPLY_VERIFY_FIXTURE=1 tsx scripts/mail-local-reply-verification-fixture.ts verify --local
`);
    return;
  }

  const { db, dispose } = await connectLocalMailReplyVerificationFixtureDb(target);
  try {
    if (command === "setup") {
      const result = await setupLocalMailReplyVerificationFixtures(db);
      const verified = await verifyLocalMailReplyVerificationFixtures(db);
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
      const removed = await cleanupLocalMailReplyVerificationFixtures(db);
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
      const verified = await verifyLocalMailReplyVerificationFixtures(db);
      const seedApi = await verifyLocalMailReplyComposeSeedApi(db);
      console.log(
        JSON.stringify(
          {
            ok: true,
            command: "verify",
            target: "local",
            verified,
            seedApi,
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
