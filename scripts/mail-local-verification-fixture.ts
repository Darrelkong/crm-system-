#!/usr/bin/env tsx
import {
  cleanupLocalMailVerificationFixtures,
  connectLocalVerificationFixtureDb,
  setupLocalMailVerificationFixtures,
  verifyLocalMailVerificationFixtures,
} from "../src/lib/mail/local-verification-fixture/service";
import {
  LOCAL_MAIL_VERIFY_D1_HINT,
  parseLocalMailVerifyCliTarget,
} from "../src/lib/mail/local-verification-fixture/guard";
import { LOCAL_MAIL_VERIFY_OPT_IN_ENV } from "../src/lib/mail/local-verification-fixture/constants";

async function main() {
  const argv = process.argv.slice(2);
  const command = argv.find((arg) => !arg.startsWith("-")) ?? "help";
  const target = parseLocalMailVerifyCliTarget(argv);

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(`Local Mail Verification Fixture (Phase 2H-3D-2B-5B)

Target: ${LOCAL_MAIL_VERIFY_D1_HINT}
Requires: ${LOCAL_MAIL_VERIFY_OPT_IN_ENV}=1 and --local

Commands:
  setup    Create deterministic LOCAL_MAIL_VERIFY_2H3D5B fixtures
  cleanup  Remove fixture namespace records only
  verify   Read-only fixture integrity validation

Examples:
  CRM_ALLOW_LOCAL_MAIL_VERIFY_FIXTURE=1 tsx scripts/mail-local-verification-fixture.ts setup --local
  CRM_ALLOW_LOCAL_MAIL_VERIFY_FIXTURE=1 tsx scripts/mail-local-verification-fixture.ts cleanup --local
  CRM_ALLOW_LOCAL_MAIL_VERIFY_FIXTURE=1 tsx scripts/mail-local-verification-fixture.ts verify --local
`);
    return;
  }

  const { db, dispose } = await connectLocalVerificationFixtureDb(target);
  try {
    if (command === "setup") {
      const result = await setupLocalMailVerificationFixtures(db);
      const verified = await verifyLocalMailVerificationFixtures(db);
      console.log(
        JSON.stringify(
          {
            ok: true,
            command: "setup",
            target: "local",
            mailboxIds: result.mailboxIds,
            messageCount: verified.messageCount,
            metadata: verified.metadata,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (command === "cleanup") {
      const removed = await cleanupLocalMailVerificationFixtures(db);
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
      const verified = await verifyLocalMailVerificationFixtures(db);
      console.log(
        JSON.stringify(
          {
            ok: true,
            command: "verify",
            target: "local",
            ...verified,
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
