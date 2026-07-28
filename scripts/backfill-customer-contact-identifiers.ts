/**
 * Customer contact identifiers backfill CLI (Phase 2A hardened).
 *
 * Official production order (DO NOT reverse — especially never
 * 0041 → backfill → deploy):
 * 1. Production D1 backup
 * 2. remote apply migration 0041
 * 3. Verify 0041 schema
 * 4. push / deploy Phase 2A dual-write app
 * 5. Verify create/edit identifier sync via integrity queries / natural ops
 *    (do not create dedicated production test customers)
 * 6. Production backfill dry-run
 * 7. dry-run conflicts must be 0
 * 8. Production backfill apply (confirm token required)
 * 9. Coverage verification
 * 10. Re-run dry-run → planned insert/delete = 0
 * 11. Re-run cross-customer Phone/WeChat/Email conflict scan
 * 12. Only then design / apply 0042 global unique
 *
 * Usage:
 *   (no args)                          → local dry-run
 *   --local                            → local dry-run
 *   --local --apply                    → local apply
 *   --remote --database=crm-db         → remote dry-run (SELECT via service)
 *   --remote --apply --database=crm-db \
 *     --confirm=BACKFILL_CUSTOMER_CONTACT_IDENTIFIERS_PRODUCTION
 *                                      → remote apply (fail-closed gates)
 *
 * No --force / skip-conflict / auto-merge. Missing gates → 0 writes.
 *
 * Remote D1 access uses getPlatformProxy with a temporary wrangler config that
 * sets d1_databases[].remote=true (project-established pattern). Dry-run path
 * only invokes read-only service methods. This round must not be used to
 * execute production writes during Phase 2A harden review.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../drizzle/schema";
import {
  decideBackfillCli,
  PRODUCTION_BACKFILL_CONFIRM,
  REQUIRED_DATABASE_NAME,
  type BackfillCliDecision,
} from "../src/lib/customers/contact-identifiers-backfill-cli";
import {
  ContactIdentifiersBackfillError,
  runContactIdentifiersBackfillApply,
  runContactIdentifiersBackfillDryRun,
  verifyCustomerContactIdentifierCoverage,
} from "../src/lib/customers/contact-identifiers-backfill";

export {
  decideBackfillCli,
  parseBackfillCliArgs,
  resolveBackfillCliDecision,
  PRODUCTION_BACKFILL_CONFIRM,
  REQUIRED_DATABASE_NAME,
} from "../src/lib/customers/contact-identifiers-backfill-cli";

function printRejected(decision: Extract<BackfillCliDecision, { ok: false }>) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        code: decision.code,
        message: decision.message,
        rowsWritten: 0,
      },
      null,
      2,
    ),
  );
}

function printDryRun(
  result: Awaited<ReturnType<typeof runContactIdentifiersBackfillDryRun>>,
  coverage: Awaited<ReturnType<typeof verifyCustomerContactIdentifierCoverage>>,
) {
  console.log(
    JSON.stringify(
      {
        mode: result.mode,
        customersScanned: result.customersScanned,
        expectedIdentifiers: result.identifierCount,
        existingIdentifiers: result.existingIdentifierCount,
        plannedInsert: result.wouldInsert,
        plannedDelete: result.wouldDelete,
        plannedKeep: result.wouldKeep,
        conflictCount: result.conflictCount,
        conflicts: result.conflicts,
        unnormalizableCount: result.unnormalizableCount,
        safeToApply: result.safeToApply,
        rowsWritten: result.rowsWritten,
        coverage: {
          ok: coverage.ok,
          missingCount: coverage.missingCount,
          extraCount: coverage.extraCount,
          ownershipMismatchCount: coverage.ownershipMismatchCount,
          crossCustomerConflictCount: coverage.crossCustomerConflictCount,
          anomalies: coverage.anomalies,
        },
      },
      null,
      2,
    ),
  );
}

/**
 * Build a temp wrangler config that points D1 at remote when needed.
 * Default wrangler.jsonc without remote:true binds local D1 — do not use it
 * for --remote.
 */
export function writeRemoteAwareWranglerConfig(input: {
  sourceConfigPath: string;
  remote: boolean;
}): { configPath: string; cleanup: () => void } {
  const raw = readFileSync(input.sourceConfigPath, "utf8");
  // Strip // line comments for JSON.parse (jsonc-lite).
  const jsonText = raw.replace(/^\s*\/\/.*$/gm, "");
  const config = JSON.parse(jsonText) as {
    d1_databases?: Array<Record<string, unknown>>;
  };
  const d1 = config.d1_databases?.[0];
  if (!d1 || d1.database_name !== REQUIRED_DATABASE_NAME) {
    throw new ContactIdentifiersBackfillError(
      "WRANGLER_D1_MISMATCH",
      `wrangler config D1 database_name must be ${REQUIRED_DATABASE_NAME}`,
    );
  }
  d1.remote = input.remote;

  const dir = mkdtempSync(join(tmpdir(), "crm-id-backfill-"));
  const configPath = join(dir, "wrangler.backfill.json");
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return {
    configPath,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    },
  };
}

async function main() {
  const decision = decideBackfillCli(process.argv.slice(2));
  if (!decision.ok) {
    printRejected(decision);
    process.exit(2);
  }

  process.env.CRM_ALLOW_TEST_DB_BIND = "1";
  const remoteConfig = writeRemoteAwareWranglerConfig({
    sourceConfigPath: "wrangler.jsonc",
    remote: decision.target === "remote",
  });

  const proxy = await getPlatformProxy<{ DB: unknown }>({
    configPath: remoteConfig.configPath,
  });

  try {
    const db = drizzle(proxy.env.DB as Parameters<typeof drizzle>[0], {
      schema,
    });

    if (decision.mode === "dry-run") {
      const result = await runContactIdentifiersBackfillDryRun(db);
      const coverage = await verifyCustomerContactIdentifierCoverage(db);
      printDryRun(result, coverage);
      process.exit(result.safeToApply ? 0 : 1);
      return;
    }

    // Apply — service re-runs dry-run conflict gate internally.
    const pre = await runContactIdentifiersBackfillDryRun(db);
    console.log(
      JSON.stringify(
        {
          phase: "pre-apply-dry-run",
          customersScanned: pre.customersScanned,
          expectedIdentifiers: pre.identifierCount,
          existingIdentifiers: pre.existingIdentifierCount,
          plannedInsert: pre.wouldInsert,
          plannedDelete: pre.wouldDelete,
          plannedKeep: pre.wouldKeep,
          conflictCount: pre.conflictCount,
          conflicts: pre.conflicts,
          unnormalizableCount: pre.unnormalizableCount,
          confirm:
            decision.target === "remote" ? PRODUCTION_BACKFILL_CONFIRM : null,
          target: decision.target,
        },
        null,
        2,
      ),
    );

    if (!pre.safeToApply) {
      console.error(
        JSON.stringify(
          {
            ok: false,
            code: "CROSS_CUSTOMER_CONFLICTS",
            message: "Refusing apply: conflicts present",
            rowsWritten: 0,
          },
          null,
          2,
        ),
      );
      process.exit(1);
      return;
    }

    const result = await runContactIdentifiersBackfillApply(db);
    const postDry = await runContactIdentifiersBackfillDryRun(db);
    console.log(
      JSON.stringify(
        {
          mode: result.mode,
          target: decision.target,
          customersScanned: result.customersScanned,
          expectedIdentifiers: result.identifierCount,
          existingIdentifierCountBefore: result.existingIdentifierCountBefore,
          inserted: result.inserted,
          deleted: result.deleted,
          kept: result.kept,
          conflictCount: result.conflictCount,
          unnormalizableCount: result.unnormalizableCount,
          customersSynced: result.customersSynced,
          rowsWritten: result.rowsWritten,
          coverage: result.coverage,
          postDryRun: {
            plannedInsert: postDry.wouldInsert,
            plannedDelete: postDry.wouldDelete,
            conflictCount: postDry.conflictCount,
            safeToApply: postDry.safeToApply,
          },
        },
        null,
        2,
      ),
    );

    if (postDry.wouldInsert !== 0 || postDry.wouldDelete !== 0) {
      process.exit(1);
    }
  } catch (error) {
    if (error instanceof ContactIdentifiersBackfillError) {
      console.error(
        JSON.stringify(
          {
            ok: false,
            code: error.code,
            message: error.message,
            rowsWritten: 0,
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }
    throw error;
  } finally {
    await proxy.dispose();
    remoteConfig.cleanup();
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
  }
}

const isDirectRun =
  process.argv[1]?.endsWith("backfill-customer-contact-identifiers.ts") ||
  process.argv[1]?.endsWith("backfill-customer-contact-identifiers.js");

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
