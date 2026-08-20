#!/usr/bin/env node
/**
 * Create a WAL-safe consistent snapshot of Local D1 (crm-db).
 * LOCAL ONLY — does not touch Remote/Production D1.
 *
 * Uses SQLite backup API via `sqlite3 .backup`, which captures committed
 * WAL state. Raw `cp *.sqlite` without WAL merge is NOT safe.
 *
 * Usage:
 *   node scripts/local-d1-safe-backup.mjs [output-directory]
 *
 * If output-directory is omitted, writes to:
 *   .local-d1-backups/safe-<timestamp>/
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const CRM_DB_FILE =
  "2caf5f58379f7d7e8d70b0e15cfe7ed9ec70b935e5815713ac19d61094cd030b.sqlite";

const wranglerState = join(
  process.cwd(),
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject",
);
const sourcePath = join(wranglerState, CRM_DB_FILE);

if (!existsSync(sourcePath)) {
  console.error(`Local D1 source not found: ${sourcePath}`);
  process.exit(1);
}

const timestamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\..+/, "")
  .replace("T", "-");
const outDir =
  process.argv[2] ?? join(process.cwd(), `.local-d1-backups/safe-${timestamp}`);
const outFile = join(outDir, "crm-db-consistent.sqlite");

mkdirSync(outDir, { recursive: true });

// SQLite backup API — read-only on source logical data; writes new snapshot file.
execFileSync("sqlite3", [sourcePath, `.backup '${outFile}'`], {
  stdio: "inherit",
});

const verify = execFileSync(
  "sqlite3",
  [
    outFile,
    "SELECT MAX(id), (SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1) FROM d1_migrations;",
  ],
  { encoding: "utf8" },
).trim();

console.log(`\nWAL-safe Local D1 snapshot created:`);
console.log(`  ${outFile}`);
console.log(`  migration state: ${verify}`);
console.log(`\nDo not upload this directory. Local development use only.`);
