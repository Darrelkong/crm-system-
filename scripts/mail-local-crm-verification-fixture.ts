#!/usr/bin/env tsx
import {
  cleanupLocalMailCrmVerificationFixtures,
  connectLocalCrmVerificationFixtureDb,
  setupLocalMailCrmVerificationFixtures,
  verifyLocalMailCrmCustomerAccess,
  verifyLocalMailCrmVerificationApiSecurity,
  verifyLocalMailCrmVerificationFixtures,
} from "../src/lib/mail/local-crm-verification-fixture/service";
import {
  LOCAL_MAIL_CRM_VERIFY_D1_HINT,
  parseLocalMailCrmVerifyCliTarget,
} from "../src/lib/mail/local-crm-verification-fixture/guard";
import { LOCAL_MAIL_CRM_VERIFY_OPT_IN_ENV } from "../src/lib/mail/local-crm-verification-fixture/constants";

async function main() {
  const argv = process.argv.slice(2);
  const command = argv.find((arg) => !arg.startsWith("-")) ?? "help";
  const target = parseLocalMailCrmVerifyCliTarget(argv);

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(`Local Mail CRM Verification Fixture (Phase 2H-4B-2)

Target: ${LOCAL_MAIL_CRM_VERIFY_D1_HINT}
Requires: ${LOCAL_MAIL_CRM_VERIFY_OPT_IN_ENV}=1 and --local

Commands:
  setup    Create deterministic LOCAL_MAIL_CRM_VERIFY_2H4B2 fixtures
  cleanup  Remove fixture namespace records only
  verify   Read-only fixture + API security validation

Examples:
  CRM_ALLOW_LOCAL_MAIL_CRM_VERIFY_FIXTURE=1 tsx scripts/mail-local-crm-verification-fixture.ts setup --local
  CRM_ALLOW_LOCAL_MAIL_CRM_VERIFY_FIXTURE=1 tsx scripts/mail-local-crm-verification-fixture.ts cleanup --local
  CRM_ALLOW_LOCAL_MAIL_CRM_VERIFY_FIXTURE=1 tsx scripts/mail-local-crm-verification-fixture.ts verify --local
`);
    return;
  }

  const { db, dispose } = await connectLocalCrmVerificationFixtureDb(target);
  try {
    if (command === "setup") {
      const result = await setupLocalMailCrmVerificationFixtures(db);
      const verified = await verifyLocalMailCrmVerificationFixtures(db);
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
      const removed = await cleanupLocalMailCrmVerificationFixtures(db);
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
      const verified = await verifyLocalMailCrmVerificationFixtures(db);
      const access = await verifyLocalMailCrmCustomerAccess(db);
      const api = await verifyLocalMailCrmVerificationApiSecurity(db);
      console.log(
        JSON.stringify(
          {
            ok: true,
            command: "verify",
            target: "local",
            verified,
            access,
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
