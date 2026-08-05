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
const SQL_0045 = readFileSync(
  join(ALL_MIGRATIONS_DIR, "0045_notification_action_states.sql"),
  "utf8",
);

const ADMIN_ID = SEED_IDS.admin;
const STAFF_ID = SEED_IDS.staffA;
const NOW = "2026-01-15T08:00:00.000Z";

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

function addMigration045(env: MigrationTestEnv): void {
  cpSync(
    join(ALL_MIGRATIONS_DIR, "0045_notification_action_states.sql"),
    join(env.migrationsDir, "0045_notification_action_states.sql"),
  );
}

function assertNotificationColumnsExist(
  env: MigrationTestEnv,
  columns: string[],
): void {
  const rows = d1Query<{ name: string }>(
    env,
    "PRAGMA table_info(notifications);",
  );
  const names = new Set(rows.map((row) => row.name));
  for (const column of columns) {
    assert.ok(names.has(column), `missing notifications.${column}`);
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

describe("migration 0045 fresh database", () => {
  it("applies 0001 through 0045 on a new local D1 database", () => {
    const env = createEnv();
    const output = applyMigrations(env);

    assert.match(output, /0045_notification_action_states\.sql/);
    assert.match(output, /✅/);

    assertNotificationColumnsExist(env, [
      "action_state",
      "grouping_key",
      "action_updated_at",
      "summary_scope",
    ]);

    const actionItems = d1Query<{ name: string }>(
      env,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reclamation_action_items';",
    );
    assert.equal(actionItems.length, 1);

    const indexes = d1Query<{ name: string }>(
      env,
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('notifications', 'reclamation_action_items');",
    );
    const indexNames = indexes.map((row) => row.name);
    assert.ok(indexNames.includes("idx_reclamation_action_items_owner_cycle"));
    assert.ok(indexNames.includes("idx_notifications_user_grouping_pending"));
  });
});

describe("migration 0045 existing database upgrade", () => {
  it("upgrades 0044 legacy notifications through 0045 without data loss", () => {
    const env = createEnv(44);
    applyMigrations(env);

    d1Exec(
      env,
      `
INSERT INTO users (
  id, email, display_name, password_hash, role, is_active,
  failed_login_attempts, locked_until, created_at, updated_at
) VALUES
  ('${ADMIN_ID}', 'admin@crm.local', 'Admin', 'hash', 'admin', 1, 0, NULL, '${NOW}', '${NOW}'),
  ('${STAFF_ID}', 'staff-a@crm.local', 'Staff A', 'hash', 'staff', 1, 0, NULL, '${NOW}', '${NOW}');

INSERT INTO notifications (
  id, user_id, type, title, message, related_entity_type, related_entity_id,
  is_read, created_at
) VALUES
  (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1',
    '${STAFF_ID}',
    'approval.pending',
    '{"key":"notificationTypes.approval_pending"}',
    '{"key":"notificationMessages.approvalPending"}',
    'approval',
    'ffffffff-ffff-ffff-ffff-fffffffffff1',
    0,
    '${NOW}'
  ),
  (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2',
    '${STAFF_ID}',
    'auto_reclaim_warning_day_6',
    '{"key":"notificationTypes.auto_reclaim_warning_day_6"}',
    '{"key":"notificationMessages.autoReclaimWarningDay6"}',
    'customer',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    1,
    '${NOW}'
  ),
  (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee3',
    '${ADMIN_ID}',
    'system.announcement',
    '{"key":"notificationTypes.system_announcement"}',
    '{"key":"notificationMessages.systemAnnouncement"}',
    NULL,
    NULL,
    0,
    '${NOW}'
  );
`.trim(),
    );

    const beforeCount = d1Query<{ n: number }>(
      env,
      "SELECT COUNT(*) AS n FROM notifications;",
    )[0]?.n;
    assert.equal(beforeCount, 3);

    addMigration045(env);
    const upgradeOutput = applyMigrations(env);
    assert.match(upgradeOutput, /0045_notification_action_states\.sql/);

    const afterCount = d1Query<{ n: number }>(
      env,
      "SELECT COUNT(*) AS n FROM notifications;",
    )[0]?.n;
    assert.equal(afterCount, 3);

    const approval = d1Query<{ action_state: string; is_read: number }>(
      env,
      `SELECT action_state, is_read FROM notifications WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1';`,
    )[0];
    assert.equal(approval?.action_state, "pending");
    assert.equal(approval?.is_read, 0);

    const legacyWarning = d1Query<{ action_state: string; is_read: number }>(
      env,
      `SELECT action_state, is_read FROM notifications WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2';`,
    )[0];
    assert.equal(legacyWarning?.action_state, "informational");
    assert.equal(legacyWarning?.is_read, 1);

    const announcement = d1Query<{ action_state: string }>(
      env,
      `SELECT action_state FROM notifications WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee3';`,
    )[0];
    assert.equal(announcement?.action_state, "informational");
  });

  it("enforces unique pending summary grouping per user", () => {
    const env = createEnv();
    applyMigrations(env);

    d1Exec(
      env,
      `
INSERT INTO users (
  id, email, display_name, password_hash, role, is_active,
  failed_login_attempts, locked_until, created_at, updated_at
) VALUES ('${STAFF_ID}', 'staff-a@crm.local', 'Staff', 'hash', 'staff', 1, 0, NULL, '${NOW}', '${NOW}');

INSERT INTO notifications (
  id, user_id, type, title, message, related_entity_type, related_entity_id,
  is_read, action_state, grouping_key, created_at
) VALUES (
  'gggggggg-gggg-gggg-gggg-ggggggggggg1',
  '${STAFF_ID}',
  'reclamation.summary.staff',
  '{"key":"notificationTypes.reclamation_summary_staff"}',
  '{"key":"notificationMessages.reclamationSummaryStaff"}',
  'reclamation_summary',
  'staff_self',
  0,
  'pending',
  'reclamation:staff:${STAFF_ID}',
  '${NOW}'
);
`.trim(),
    );

    const duplicateSqlFile = join(env.migrationsDir, "duplicate-summary.sql");
    writeFileSync(
      duplicateSqlFile,
      `
INSERT INTO notifications (
  id, user_id, type, title, message, related_entity_type, related_entity_id,
  is_read, action_state, grouping_key, created_at
) VALUES (
  'gggggggg-gggg-gggg-gggg-ggggggggggg2',
  '${STAFF_ID}',
  'reclamation.summary.staff',
  '{"key":"notificationTypes.reclamation_summary_staff"}',
  '{"key":"notificationMessages.reclamationSummaryStaff"}',
  'reclamation_summary',
  'staff_self',
  0,
  'pending',
  'reclamation:staff:${STAFF_ID}',
  '${NOW}'
);
`.trim(),
    );

    const duplicateInsert = wrangler(
      env,
      ["execute", "--file", duplicateSqlFile],
      { allowFailure: true },
    );
    rmSync(duplicateSqlFile, { force: true });
    assert.match(duplicateInsert, /UNIQUE constraint failed/i);
  });
});

describe("migration 0045 idempotent re-apply", () => {
  it("does not mutate data when migrations are applied again", () => {
    const env = createEnv();
    applyMigrations(env);

    d1Exec(
      env,
      `
INSERT INTO users (
  id, email, display_name, password_hash, role, is_active,
  failed_login_attempts, locked_until, created_at, updated_at
) VALUES ('${STAFF_ID}', 'staff-a@crm.local', 'Staff', 'hash', 'staff', 1, 0, NULL, '${NOW}', '${NOW}');

INSERT INTO notifications (
  id, user_id, type, title, message, is_read, action_state, created_at
) VALUES (
  'hhhhhhhh-hhhh-hhhh-hhhh-hhhhhhhhhhh1',
  '${STAFF_ID}',
  'system.announcement',
  '{"key":"notificationTypes.system_announcement"}',
  '{"key":"notificationMessages.systemAnnouncement"}',
  1,
  'informational',
  '${NOW}'
);
`.trim(),
    );

    const before = {
      notificationCount: d1Query<{ n: number }>(
        env,
        "SELECT COUNT(*) AS n FROM notifications;",
      )[0]?.n,
      migrationCount: d1Query<{ n: number }>(
        env,
        "SELECT COUNT(*) AS n FROM d1_migrations;",
      )[0]?.n,
    };

    const secondApply = applyMigrations(env);
    assert.match(secondApply, /No migrations to apply/i);

    const after = {
      notificationCount: d1Query<{ n: number }>(
        env,
        "SELECT COUNT(*) AS n FROM notifications;",
      )[0]?.n,
      migrationCount: d1Query<{ n: number }>(
        env,
        "SELECT COUNT(*) AS n FROM d1_migrations;",
      )[0]?.n,
    };

    assert.equal(after.notificationCount, before.notificationCount);
    assert.equal(after.migrationCount, before.migrationCount);
    assert.doesNotMatch(SQL_0045, /DROP TABLE/i);
  });
});
