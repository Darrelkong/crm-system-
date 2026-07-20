/**
 * Missing-primary assignee backfill CLI.
 *
 * Default mode is dry-run (zero writes).
 * Apply requires ALL of:
 *   --apply --expected-count --expected-snapshot --manifest-out
 * and an explicit --local target (Phase 3B).
 *
 * --remote is accepted only to fail closed with a clear message:
 * production remote dry-run/apply belongs to a later dedicated phase.
 */

import {
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../drizzle/schema";
import {
  MissingPrimaryBackfillError,
  MissingPrimaryRollbackError,
  runMissingPrimaryApply,
  runMissingPrimaryDryRun,
  type MissingPrimaryBackfillManifest,
  type MissingPrimaryRollbackManifest,
} from "../src/lib/customers/missing-primary-backfill";

export function parseArgs(argv: string[]) {
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

/** Atomic write: temp file → fsync → rename over destination. */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  const tmp = join(
    dir,
    `.${filePath.split("/").pop()}.${process.pid}.${Date.now()}.tmp`,
  );
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, payload, undefined, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, filePath);
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
      "Refusing --remote in Phase 3B CLI. Production remote dry-run/apply is a later phase.",
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
    if (!args.manifestOut) {
      console.error(
        "--apply requires --manifest-out <path> (fail-closed durability)",
      );
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

    const manifestPath = args.manifestOut!;

    try {
      const result = await runMissingPrimaryApply(db, {
        expectedCount: args.expectedCount!,
        expectedSnapshot: args.expectedSnapshot!,
        onManifestUpdate: (manifest: MissingPrimaryBackfillManifest) => {
          writeJsonAtomic(manifestPath, manifest);
        },
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
    } catch (error) {
      if (error instanceof MissingPrimaryBackfillError) {
        if (error.manifest) {
          writeJsonAtomic(manifestPath, error.manifest);
        }
        console.error(
          JSON.stringify(
            {
              ok: false,
              code: error.code,
              message: error.message,
              rowsWritten: error.manifest?.insertedRows.length ?? 0,
              manifestStatus: error.manifest?.status ?? null,
              completedChunks: error.manifest?.completedChunks ?? 0,
            },
            null,
            2,
          ),
        );
        process.exit(1);
      }
      if (error instanceof MissingPrimaryRollbackError) {
        console.error(
          JSON.stringify(
            {
              ok: false,
              code: error.code,
              message: error.message,
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

// Avoid executing main when imported by tests.
const isDirectRun =
  process.argv[1]?.endsWith("backfill-missing-primary-assignees.ts") ||
  process.argv[1]?.endsWith("backfill-missing-primary-assignees.js");

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export type { MissingPrimaryBackfillManifest, MissingPrimaryRollbackManifest };
