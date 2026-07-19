/**
 * Missing-primary assignee backfill CLI.
 *
 * Default mode is dry-run (zero writes).
 * Apply requires ALL of: --apply --expected-count --expected-snapshot
 * and an explicit --local target (Phase 3A).
 *
 * --remote is accepted only to fail closed with a clear message:
 * production remote dry-run/apply belongs to a later dedicated phase.
 */

import { writeFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../drizzle/schema";
import {
  MissingPrimaryBackfillError,
  runMissingPrimaryApply,
  runMissingPrimaryDryRun,
} from "../src/lib/customers/missing-primary-backfill";

function parseArgs(argv: string[]) {
  const hasLocal = argv.includes("--local");
  const hasRemote = argv.includes("--remote");
  const apply = argv.includes("--apply");

  let expectedCount: number | null = null;
  let expectedSnapshot: string | null = null;
  let manifestOut: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--expected-count") {
      const raw = argv[i + 1];
      expectedCount = raw != null ? Number(raw) : NaN;
      i += 1;
    } else if (arg?.startsWith("--expected-count=")) {
      expectedCount = Number(arg.slice("--expected-count=".length));
    } else if (arg === "--expected-snapshot") {
      expectedSnapshot = argv[i + 1] ?? null;
      i += 1;
    } else if (arg?.startsWith("--expected-snapshot=")) {
      expectedSnapshot = arg.slice("--expected-snapshot=".length);
    } else if (arg === "--manifest-out") {
      manifestOut = argv[i + 1] ?? null;
      i += 1;
    } else if (arg?.startsWith("--manifest-out=")) {
      manifestOut = arg.slice("--manifest-out=".length);
    }
  }

  return {
    hasLocal,
    hasRemote,
    apply,
    expectedCount,
    expectedSnapshot,
    manifestOut,
  };
}

function printSafeDryRun(
  result: Awaited<ReturnType<typeof runMissingPrimaryDryRun>>,
) {
  console.log(
    JSON.stringify(
      {
        mode: result.mode,
        targetCount: result.targetCount,
        snapshotHash: result.snapshotHash,
        safeToApply: result.safeToApply,
        blockers: result.blockers,
        anomalies: result.anomalies,
        rowsWritten: result.rowsWritten,
        targets: result.targets,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.hasLocal === args.hasRemote) {
    console.error(
      "Must pass exactly one of --local or --remote (no default target).",
    );
    process.exit(2);
  }

  if (args.hasRemote) {
    console.error(
      "Refusing --remote in Phase 3A CLI. Production remote dry-run/apply is a later phase.",
    );
    process.exit(2);
  }

  if (args.apply) {
    if (args.expectedCount == null || Number.isNaN(args.expectedCount)) {
      console.error("--apply requires --expected-count <n>");
      process.exit(2);
    }
    if (!args.expectedSnapshot) {
      console.error("--apply requires --expected-snapshot <sha256>");
      process.exit(2);
    }
  }

  process.env.CRM_ALLOW_TEST_DB_BIND = "1";
  const proxy = await getPlatformProxy<{ DB: unknown }>({
    configPath: "wrangler.jsonc",
  });

  try {
    const db = drizzle(proxy.env.DB as Parameters<typeof drizzle>[0], {
      schema,
    });

    if (!args.apply) {
      const result = await runMissingPrimaryDryRun(db);
      printSafeDryRun(result);
      return;
    }

    try {
      const result = await runMissingPrimaryApply(db, {
        expectedCount: args.expectedCount!,
        expectedSnapshot: args.expectedSnapshot!,
      });
      console.log(
        JSON.stringify(
          {
            mode: result.mode,
            backfillRunId: result.backfillRunId,
            attemptedCount: result.attemptedCount,
            insertedCount: result.insertedCount,
            skippedAlreadyCompliant: result.skippedAlreadyCompliant,
            snapshotHash: result.snapshotHash,
            rowsWritten: result.rowsWritten,
            manifest: result.manifest,
          },
          null,
          2,
        ),
      );
      if (args.manifestOut) {
        writeFileSync(
          args.manifestOut,
          JSON.stringify(
            {
              backfillRunId: result.backfillRunId,
              snapshotHash: result.snapshotHash,
              manifest: result.manifest,
            },
            null,
            2,
          ),
          "utf8",
        );
      }
    } catch (error) {
      if (error instanceof MissingPrimaryBackfillError) {
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
    }
  } finally {
    await proxy.dispose();
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
