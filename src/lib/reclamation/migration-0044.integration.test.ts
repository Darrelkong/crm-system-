import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { SEED_IDS } from "@/lib/constants/seed-ids";

const ROOT = process.cwd();
const ALL_MIGRATIONS_DIR = join(ROOT, "drizzle/migrations");
const SQL_0044 = readFileSync(
  join(ALL_MIGRATIONS_DIR, "0044_reclamation_cycle_and_warnings.sql"),
  "utf8",
);

const ADMIN_ID = SEED_IDS.admin;
const STAFF_ID = SEED_IDS.staffA;
const OWNED_CUSTOMER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const POOL_CUSTOMER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const FOLLOWUP_CUSTOMER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";
const LEGACY_CUSTOMER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4";
const NOW = "2026-01-15T08:00:00.000Z";
const CYCLE_ANCHOR = "2025-12-01T00:00:00.000Z";

interface MigrationTestEnv {
  persistDir: string;
  migrationsDir: string;
  configPath: string;
}

const cleanupDirs: string[] = [];

function migrationNumber(fileName: string): number {
  return Number.parseInt(fileName.slice(0, 4), 10);
}

function copyMigrations(maxMigration?: number): string {
  const migrationsDir = mkdtempSync(join(tmpdir(), "crm-mig-files-"));
  cleanupDirs.push(migrationsDir);

  for (const fileName of readdirSync(ALL_MIGRATIONS_DIR).sort()) {
    if (!fileName.endsWith(".sql")) continue;
    if (maxMigration !== undefined && migrationNumber(fileName) > maxMigration) {
      continue;
    }
    cpSync(join(ALL_MIGRATIONS_DIR, fileName), join(migrationsDir, fileName));
  }

  return migrationsDir;
}

function createEnv(maxMigration?: number): MigrationTestEnv {
  const persistDir = mkdtempSync(join(tmpdir(), "crm-mig-persist-"));
  const migrationsDir = copyMigrations(maxMigration);
  cleanupDirs.push(persistDir);

  const configPath = join(migrationsDir, "wrangler-test.jsonc");
  writeFileSync(
    configPath,
    JSON.stringify({
      d1_databases: [
        {
          binding: "DB",
          database_name: "crm-db",
          database_id: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          migrations_dir: migrationsDir,
        },
      ],
    }),
  );

  return { persistDir, migrationsDir, configPath };
}

function wrangler(
  env: MigrationTestEnv,
  subcommand: string[],
  options: { allowFailure?: boolean } = {},
): string {
  const args = [
    "wrangler",
    "d1",
    ...subcommand,
    "crm-db",
    "--local",
    "--persist-to",
    env.persistDir,
    "-c",
    env.configPath,
  ];

  try {
    return execFileSync("npx", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    });
  } catch (error) {
    if (options.allowFailure) {
      const err = error as { stdout?: string; stderr?: string };
      return `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    throw error;
  }
}

function applyMigrations(env: MigrationTestEnv): string {
  return wrangler(env, ["migrations", "apply"]);
}

function d1Query<T extends Record<string, unknown>>(
  env: MigrationTestEnv,
  sql: string,
): T[] {
  const output = wrangler(env, [
    "execute",
    "--command",
    sql.replace(/\s+/g, " ").trim(),
    "--json",
  ]);
  const parsed = JSON.parse(output) as Array<{ results: T[] }>;
  return parsed[0]?.results ?? [];
}

function d1Exec(env: MigrationTestEnv, sql: string): void {
  const sqlFile = join(
    env.migrationsDir,
    `exec-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`,
  );
  writeFileSync(sqlFile, sql);
  try {
    wrangler(env, ["execute", "--file", sqlFile]);
  } finally {
    rmSync(sqlFile, { force: true });
  }
}

function addMigration044(env: MigrationTestEnv): void {
  cpSync(
    join(ALL_MIGRATIONS_DIR, "0044_reclamation_cycle_and_warnings.sql"),
    join(env.migrationsDir, "0044_reclamation_cycle_and_warnings.sql"),
  );
}

function buildUpgradeSeedSql(): string {
  return `
INSERT INTO users (
  id, email, display_name, password_hash, role, is_active,
  failed_login_attempts, locked_until, created_at, updated_at
) VALUES
  ('${ADMIN_ID}', 'admin@crm.local', 'Admin', 'hash', 'admin', 1, 0, NULL, '${NOW}', '${NOW}'),
  ('${STAFF_ID}', 'staff-a@crm.local', 'Staff A', 'hash', 'staff', 1, 0, NULL, '${NOW}', '${NOW}');

INSERT INTO system_settings (key, value, updated_at) VALUES
  ('business_timezone', 'Asia/Shanghai', '${NOW}'),
  ('automatic_reclaim_days', '60', '${NOW}');

INSERT INTO customers (
  id, customer_name, source, sales_stage, owner_id, status,
  last_valid_follow_up_at, created_by, updated_by, created_at, updated_at
) VALUES
  (
    '${OWNED_CUSTOMER_ID}', 'Owned Active', 'referral', 'negotiation',
    '${STAFF_ID}', 'active', '${CYCLE_ANCHOR}', '${STAFF_ID}', '${STAFF_ID}', '${NOW}', '${NOW}'
  ),
  (
    '${POOL_CUSTOMER_ID}', 'Public Pool', 'referral', 'new_lead',
    NULL, 'public_pool', NULL, '${STAFF_ID}', '${STAFF_ID}', '${NOW}', '${NOW}'
  ),
  (
    '${FOLLOWUP_CUSTOMER_ID}', 'Follow-up History', 'referral', 'negotiation',
    '${STAFF_ID}', 'active', '${CYCLE_ANCHOR}', '${STAFF_ID}', '${STAFF_ID}', '${NOW}', '${NOW}'
  ),
  (
    '${LEGACY_CUSTOMER_ID}', 'Legacy No Cycle', 'referral', 'negotiation',
    '${STAFF_ID}', 'active', '${CYCLE_ANCHOR}', '${STAFF_ID}', '${STAFF_ID}', '${NOW}', '${NOW}'
  );

INSERT INTO follow_ups (
  id, customer_id, user_id, content, follow_up_type, created_at
) VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
  '${FOLLOWUP_CUSTOMER_ID}',
  '${STAFF_ID}',
  'Historical valid follow-up',
  'call',
  '${CYCLE_ANCHOR}'
);

INSERT INTO reclamation_warning_logs (
  id, customer_id, warning_type, warning_date, owner_id, created_at
) VALUES
  (
    'cccccccc-cccc-cccc-cccc-ccccccccccc1',
    '${OWNED_CUSTOMER_ID}',
    'day_6',
    '2026-01-10',
    '${STAFF_ID}',
    '${NOW}'
  ),
  (
    'cccccccc-cccc-cccc-cccc-ccccccccccc2',
    '${OWNED_CUSTOMER_ID}',
    'day_6',
    '2026-01-11',
    '${STAFF_ID}',
    '${NOW}'
  ),
  (
    'cccccccc-cccc-cccc-cccc-ccccccccccc3',
    '${OWNED_CUSTOMER_ID}',
    'day_6',
    '2026-01-12',
    '${STAFF_ID}',
    '${NOW}'
  );
`.trim();
}

function assertCustomerColumnsExist(
  env: MigrationTestEnv,
  columns: string[],
): void {
  const rows = d1Query<{ name: string }>(
    env,
    "PRAGMA table_info(customers);",
  );
  const names = new Set(rows.map((row) => row.name));
  for (const column of columns) {
    assert.ok(names.has(column), `missing customers.${column}`);
  }
}

function assertWarningLogColumnsExist(
  env: MigrationTestEnv,
  columns: string[],
): void {
  const rows = d1Query<{ name: string }>(
    env,
    "PRAGMA table_info(reclamation_warning_logs);",
  );
  const names = new Set(rows.map((row) => row.name));
  for (const column of columns) {
    assert.ok(names.has(column), `missing reclamation_warning_logs.${column}`);
  }
}

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("migration 0044 fresh database", () => {
  it("applies 0001 through 0044 on a new local D1 database", () => {
    const env = createEnv();
    const output = applyMigrations(env);

    assert.match(output, /0044_reclamation_cycle_and_warnings\.sql/);
    assert.match(output, /✅/);

    assertCustomerColumnsExist(env, [
      "reclamation_cycle_started_at",
      "reclaim_rule_grace_until",
    ]);
    assertWarningLogColumnsExist(env, [
      "cycle_started_at",
      "warning_milestone",
      "reclaim_days_snapshot",
    ]);

    const indexes = d1Query<{ name: string }>(
      env,
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'reclamation_warning_logs';",
    );
    assert.ok(
      indexes.some((row) => row.name === "idx_reclamation_warning_cycle_milestone"),
    );
  });

  it("supports reclamation queries, warning writes, and CAS guards on fresh DB", () => {
    const env = createEnv();
    applyMigrations(env);

    d1Exec(
      env,
      `
INSERT INTO users (
  id, email, display_name, password_hash, role, is_active,
  failed_login_attempts, locked_until, created_at, updated_at
) VALUES ('${STAFF_ID}', 'staff-a@crm.local', 'Staff', 'hash', 'staff', 1, 0, NULL, '${NOW}', '${NOW}');

INSERT INTO customers (
  id, customer_name, source, sales_stage, owner_id, status,
  last_valid_follow_up_at, reclamation_cycle_started_at,
  created_by, updated_by, created_at, updated_at
) VALUES (
  '${OWNED_CUSTOMER_ID}', 'Fresh Owned', 'referral', 'negotiation',
  '${STAFF_ID}', 'active', '${CYCLE_ANCHOR}', '${CYCLE_ANCHOR}',
  '${STAFF_ID}', '${STAFF_ID}', '${NOW}', '${NOW}'
);
`.trim(),
    );

    const eligible = d1Query<{ id: string }>(
      env,
      `
SELECT id FROM customers
WHERE status = 'active'
  AND owner_id IS NOT NULL
  AND deleted_at IS NULL
  AND sales_stage NOT IN ('closed_won', 'converted', 'on_hold');
`.trim(),
    );
    assert.equal(eligible.length, 1);

    d1Exec(
      env,
      `
INSERT INTO reclamation_warning_logs (
  id, customer_id, warning_type, warning_date, cycle_started_at,
  warning_milestone, reclaim_days_snapshot, owner_id, created_at
) VALUES (
  'dddddddd-dddd-dddd-dddd-ddddddddddd1',
  '${OWNED_CUSTOMER_ID}',
  'day_6',
  '2026-01-15',
  '${CYCLE_ANCHOR}',
  7,
  45,
  '${STAFF_ID}',
  '${NOW}'
);
`.trim(),
    );

    const snapshot = {
      id: OWNED_CUSTOMER_ID,
      ownerId: STAFF_ID,
      status: "active" as const,
      updatedAt: NOW,
      lastValidFollowUpAt: CYCLE_ANCHOR,
      reclamationCycleStartedAt: CYCLE_ANCHOR,
      reclaimRuleGraceUntil: null,
      isPinned: 0,
      salesStage: "negotiation",
      deletedAt: null,
      createdAt: NOW,
    };
    assert.ok(snapshot);
    assert.equal(snapshot.ownerId, STAFF_ID);
    assert.equal(snapshot.id, OWNED_CUSTOMER_ID);
  });
});

describe("migration 0044 existing database upgrade", () => {
  it("upgrades 0043 legacy data through 0044 without data loss", () => {
    const env = createEnv(43);
    applyMigrations(env);
    d1Exec(env, buildUpgradeSeedSql());

    const beforeCustomers = d1Query<{ n: number }>(
      env,
      "SELECT COUNT(*) AS n FROM customers;",
    )[0]?.n;
    const beforeWarnings = d1Query<{ n: number }>(
      env,
      "SELECT COUNT(*) AS n FROM reclamation_warning_logs;",
    )[0]?.n;
    assert.equal(beforeCustomers, 4);
    assert.equal(beforeWarnings, 3);

    addMigration044(env);
    const upgradeOutput = applyMigrations(env);
    assert.match(upgradeOutput, /0044_reclamation_cycle_and_warnings\.sql/);

    const timezone = d1Query<{ value: string }>(
      env,
      "SELECT value FROM system_settings WHERE key = 'business_timezone';",
    )[0]?.value;
    assert.equal(timezone, "Asia/Hong_Kong");

    const reclaimDays = d1Query<{ value: string }>(
      env,
      "SELECT value FROM system_settings WHERE key = 'automatic_reclaim_days';",
    )[0]?.value;
    assert.equal(reclaimDays, "60");

    const afterCustomers = d1Query<{ n: number }>(
      env,
      "SELECT COUNT(*) AS n FROM customers;",
    )[0]?.n;
    assert.equal(afterCustomers, 4);

    const legacyCycle = d1Query<{ reclamation_cycle_started_at: string | null }>(
      env,
      `SELECT reclamation_cycle_started_at FROM customers WHERE id = '${LEGACY_CUSTOMER_ID}';`,
    )[0];
    assert.equal(legacyCycle?.reclamation_cycle_started_at, null);

    const warningCount = d1Query<{ n: number }>(
      env,
      "SELECT COUNT(*) AS n FROM reclamation_warning_logs;",
    )[0]?.n;
    assert.equal(warningCount, 3);

    const nullCycleWarnings = d1Query<{ n: number }>(
      env,
      "SELECT COUNT(*) AS n FROM reclamation_warning_logs WHERE cycle_started_at IS NULL;",
    )[0]?.n;
    assert.equal(nullCycleWarnings, 3);

    d1Exec(
      env,
      `
INSERT INTO reclamation_warning_logs (
  id, customer_id, warning_type, warning_date, cycle_started_at,
  warning_milestone, reclaim_days_snapshot, owner_id, created_at
) VALUES (
  'dddddddd-dddd-dddd-dddd-ddddddddddd1',
  '${OWNED_CUSTOMER_ID}',
  'day_6',
  '2026-01-20',
  '${CYCLE_ANCHOR}',
  14,
  60,
  '${STAFF_ID}',
  '${NOW}'
);
`.trim(),
    );

    const duplicateSqlFile = join(env.migrationsDir, "duplicate-warning.sql");
    writeFileSync(
      duplicateSqlFile,
      `
INSERT INTO reclamation_warning_logs (
  id, customer_id, warning_type, warning_date, cycle_started_at,
  warning_milestone, reclaim_days_snapshot, owner_id, created_at
) VALUES (
  'dddddddd-dddd-dddd-dddd-ddddddddddd2',
  '${OWNED_CUSTOMER_ID}',
  'day_6',
  '2026-01-21',
  '${CYCLE_ANCHOR}',
  14,
  60,
  '${STAFF_ID}',
  '${NOW}'
);
`.trim(),
    );

    const duplicateInsert = wrangler(
      env,
      [
        "execute",
        "--file",
        duplicateSqlFile,
      ],
      { allowFailure: true },
    );
    rmSync(duplicateSqlFile, { force: true });
    assert.match(duplicateInsert, /UNIQUE constraint failed/i);

    d1Exec(
      env,
      `
INSERT INTO reclamation_warning_logs (
  id, customer_id, warning_type, warning_date, cycle_started_at,
  warning_milestone, reclaim_days_snapshot, owner_id, created_at
) VALUES (
  'dddddddd-dddd-dddd-dddd-ddddddddddd3',
  '${POOL_CUSTOMER_ID}',
  'day_6',
  '2026-01-22',
  '${CYCLE_ANCHOR}',
  14,
  60,
  '${STAFF_ID}',
  '${NOW}'
);
`.trim(),
    );

    d1Exec(
      env,
      `
INSERT INTO reclamation_warning_logs (
  id, customer_id, warning_type, warning_date, cycle_started_at,
  warning_milestone, reclaim_days_snapshot, owner_id, created_at
) VALUES (
  'dddddddd-dddd-dddd-dddd-ddddddddddd4',
  '${OWNED_CUSTOMER_ID}',
  'day_6',
  '2026-01-23',
  '2026-02-01T00:00:00.000Z',
  14,
  60,
  '${STAFF_ID}',
  '${NOW}'
);
`.trim(),
    );

    const ownedEligible = d1Query<{ n: number }>(
      env,
      `
SELECT COUNT(*) AS n FROM customers
WHERE id = '${OWNED_CUSTOMER_ID}'
  AND status = 'active'
  AND owner_id IS NOT NULL;
`.trim(),
    )[0]?.n;
    assert.equal(ownedEligible, 1);

    const poolEligible = d1Query<{ n: number }>(
      env,
      `
SELECT COUNT(*) AS n FROM customers
WHERE id = '${POOL_CUSTOMER_ID}'
  AND status = 'public_pool'
  AND owner_id IS NULL;
`.trim(),
    )[0]?.n;
    assert.equal(poolEligible, 1);
  });
});

describe("migration 0044 idempotent re-apply", () => {
  it("does not mutate data when migrations are applied again", () => {
    const env = createEnv();
    applyMigrations(env);

    d1Exec(
      env,
      `
INSERT INTO system_settings (key, value, updated_at) VALUES
  ('business_timezone', 'Asia/Hong_Kong', '${NOW}'),
  ('automatic_reclaim_days', '52', '${NOW}');
`.trim(),
    );

    const before = {
      timezone: d1Query<{ value: string }>(
        env,
        "SELECT value FROM system_settings WHERE key = 'business_timezone';",
      )[0]?.value,
      reclaimDays: d1Query<{ value: string }>(
        env,
        "SELECT value FROM system_settings WHERE key = 'automatic_reclaim_days';",
      )[0]?.value,
      indexes: d1Query<{ name: string }>(
        env,
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'reclamation_warning_logs';",
      ).map((row) => row.name),
      migrationCount: d1Query<{ n: number }>(
        env,
        "SELECT COUNT(*) AS n FROM d1_migrations;",
      )[0]?.n,
    };

    const secondApply = applyMigrations(env);
    assert.match(secondApply, /No migrations to apply/i);

    const after = {
      timezone: d1Query<{ value: string }>(
        env,
        "SELECT value FROM system_settings WHERE key = 'business_timezone';",
      )[0]?.value,
      reclaimDays: d1Query<{ value: string }>(
        env,
        "SELECT value FROM system_settings WHERE key = 'automatic_reclaim_days';",
      )[0]?.value,
      indexes: d1Query<{ name: string }>(
        env,
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'reclamation_warning_logs';",
      ).map((row) => row.name),
      migrationCount: d1Query<{ n: number }>(
        env,
        "SELECT COUNT(*) AS n FROM d1_migrations;",
      )[0]?.n,
    };

    assert.deepEqual(after.timezone, before.timezone);
    assert.deepEqual(after.reclaimDays, before.reclaimDays);
    assert.deepEqual(after.indexes.sort(), before.indexes.sort());
    assert.equal(after.migrationCount, before.migrationCount);
    assert.doesNotMatch(SQL_0044, /DROP TABLE/i);
  });
});
