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

const ROOT = process.cwd();
const ALL_MIGRATIONS_DIR = join(ROOT, "drizzle/migrations");
const SQL_0047 = readFileSync(
  join(ALL_MIGRATIONS_DIR, "0047_link_family_customer_approval.sql"),
  "utf8",
);

const ADMIN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const STAFF_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
const CUSTOMER_ID = "cccccccc-cccc-cccc-cccc-ccccccccccc1";
const CUSTOMER_B_ID = "cccccccc-cccc-cccc-cccc-ccccccccccc2";
const NOW = "2026-08-12T10:00:00.000Z";

const REQUEST_TYPES = [
  "delete_customer",
  "transfer_customer",
  "merge_customers",
  "closed_won",
  "second_conversion",
  "create_on_hold_customer",
  "update_customer_assignees",
  "paid_customer",
] as const;

const EXPECTED_INDEXES = [
  "idx_approvals_status",
  "idx_approvals_customer_id",
  "idx_approvals_requested_by",
  "idx_approvals_pending_lookup",
] as const;

interface MigrationTestEnv {
  persistDir: string;
  migrationsDir: string;
  configPath: string;
}

interface ApprovalRow {
  id: string;
  request_type: string;
  status: string;
  customer_id: string;
  requested_by: string;
  target_user_id: string | null;
  related_customer_ids: string | null;
  payload: string | null;
  reason: string;
  admin_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
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

function addMigration047(env: MigrationTestEnv): void {
  cpSync(
    join(ALL_MIGRATIONS_DIR, "0047_link_family_customer_approval.sql"),
    join(env.migrationsDir, "0047_link_family_customer_approval.sql"),
  );
}

function seedPrerequisites(env: MigrationTestEnv): void {
  d1Exec(
    env,
    `
INSERT INTO users (
  id, email, display_name, password_hash, role, is_active,
  failed_login_attempts, locked_until, created_at, updated_at
) VALUES
  ('${ADMIN_ID}', 'admin@crm.local', 'Admin', 'hash', 'admin', 1, 0, NULL, '${NOW}', '${NOW}'),
  ('${STAFF_ID}', 'staff@crm.local', 'Staff', 'hash', 'staff', 1, 0, NULL, '${NOW}', '${NOW}');

INSERT INTO customers (
  id, customer_name, source, sales_stage, owner_id, status,
  created_by, updated_by, created_at, updated_at
) VALUES
  (
    '${CUSTOMER_ID}', 'Customer A', 'referral', 'new_lead',
    '${STAFF_ID}', 'active', '${STAFF_ID}', '${STAFF_ID}', '${NOW}', '${NOW}'
  ),
  (
    '${CUSTOMER_B_ID}', 'Customer B', 'referral', 'new_lead',
    '${STAFF_ID}', 'active', '${STAFF_ID}', '${STAFF_ID}', '${NOW}', '${NOW}'
  );
`.trim(),
  );
}

function seedAllApprovalTypes(env: MigrationTestEnv): void {
  const statuses = ["pending", "approved", "rejected"] as const;
  const values = REQUEST_TYPES.map((requestType, index) => {
    const status = statuses[index % statuses.length];
    const id = `dddddddd-dddd-dddd-dddd-${String(index + 1).padStart(12, "0")}`;
    const reviewed =
      status === "pending"
        ? "NULL, NULL"
        : `'${ADMIN_ID}', '${NOW}'`;
    const targetUser =
      requestType === "transfer_customer" ? `'${ADMIN_ID}'` : "NULL";
    const relatedIds =
      requestType === "merge_customers"
        ? `'["${CUSTOMER_B_ID}"]'`
        : "NULL";
    const payload =
      requestType === "update_customer_assignees"
        ? `'{"assigneeUserIds":["${STAFF_ID}"]}'`
        : requestType === "paid_customer"
          ? `'{"paidAmount":100,"serviceItems":["svc"]}'`
          : "NULL";
    const adminComment =
      status === "pending" ? "NULL" : `'Reviewed for ${requestType}'`;

    return `(
      '${id}',
      '${requestType}',
      '${status}',
      '${CUSTOMER_ID}',
      '${STAFF_ID}',
      ${targetUser},
      ${relatedIds},
      ${payload},
      'Seed ${requestType}',
      ${adminComment},
      ${reviewed},
      '${NOW}',
      '${NOW}'
    )`;
  });

  d1Exec(
    env,
    `
INSERT INTO approvals (
  id,
  request_type,
  status,
  customer_id,
  requested_by,
  target_user_id,
  related_customer_ids,
  payload,
  reason,
  admin_comment,
  reviewed_by,
  reviewed_at,
  created_at,
  updated_at
) VALUES
${values.join(",\n")};
`.trim(),
  );
}

function readApprovals(env: MigrationTestEnv): ApprovalRow[] {
  return d1Query<ApprovalRow>(
    env,
    `SELECT
      id,
      request_type,
      status,
      customer_id,
      requested_by,
      target_user_id,
      related_customer_ids,
      payload,
      reason,
      admin_comment,
      reviewed_by,
      reviewed_at,
      created_at,
      updated_at
    FROM approvals
    ORDER BY id;`,
  );
}

function assertIndexes(env: MigrationTestEnv): void {
  const indexes = d1Query<{ name: string; sql: string | null }>(
    env,
    `SELECT name, sql FROM sqlite_master WHERE tbl_name = 'approvals' AND type = 'index' ORDER BY name;`,
  );
  const names = indexes
    .map((row) => row.name)
    .filter((name) => name !== "sqlite_autoindex_approvals_1")
    .sort();
  assert.deepEqual(names, [...EXPECTED_INDEXES].sort());

  const pendingLookup = indexes.find(
    (row) => row.name === "idx_approvals_pending_lookup",
  );
  assert.match(
    pendingLookup?.sql ?? "",
    /customer_id,\s*request_type,\s*status/,
  );
}

function assertForeignKeys(env: MigrationTestEnv): void {
  const violations = d1Query<{ table: string; rowid: number; parent: string; fkid: number }>(
    env,
    "PRAGMA foreign_key_check;",
  );
  assert.deepEqual(violations, []);
}

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("Migration 0047 link_family_customer approval", () => {
  it("follows the established approvals rebuild pattern with only request_type expansion", () => {
    const ddl = SQL_0047.split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    assert.match(ddl, /CREATE TABLE approvals_new/);
    assert.match(ddl, /INSERT INTO approvals_new[\s\S]*SELECT[\s\S]*FROM approvals/);
    assert.match(ddl, /DROP TABLE approvals/);
    assert.match(ddl, /ALTER TABLE approvals_new RENAME TO approvals/);
    assert.match(ddl, /'link_family_customer'/);
    for (const requestType of REQUEST_TYPES) {
      assert.match(ddl, new RegExp(`'${requestType}'`));
    }
    assert.doesNotMatch(ddl, /ALTER TABLE customers/i);
    assert.doesNotMatch(ddl, /customer_household/i);
  });

  it("applies on a clean database through the full migration chain", () => {
    const env = createEnv();
    const output = applyMigrations(env);
    assert.match(output, /0047_link_family_customer_approval\.sql/);

    const ddl = d1Query<{ sql: string }>(
      env,
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='approvals';`,
    )[0]?.sql;
    assert.match(ddl ?? "", /'link_family_customer'/);
    assertIndexes(env);
    assertForeignKeys(env);

    const tempTable = d1Query<{ name: string }>(
      env,
      `SELECT name FROM sqlite_master WHERE type='table' AND name='approvals_new';`,
    );
    assert.equal(tempTable.length, 0);
  });

  it("upgrades from 0046 while preserving existing approval rows exactly", () => {
    const env = createEnv(46);
    applyMigrations(env);
    seedPrerequisites(env);
    seedAllApprovalTypes(env);

    const beforeRows = readApprovals(env);
    assert.equal(beforeRows.length, REQUEST_TYPES.length);

    addMigration047(env);
    applyMigrations(env);

    const afterRows = readApprovals(env);
    assert.deepEqual(afterRows, beforeRows);

    const count = d1Query<{ n: number }>(
      env,
      "SELECT COUNT(*) AS n FROM approvals;",
    )[0]?.n;
    assert.equal(count, REQUEST_TYPES.length);

    const distinctIds = d1Query<{ n: number }>(
      env,
      "SELECT COUNT(DISTINCT id) AS n FROM approvals;",
    )[0]?.n;
    assert.equal(distinctIds, REQUEST_TYPES.length);

    assertIndexes(env);
    assertForeignKeys(env);
  });

  it("accepts link_family_customer and rejects invalid request types", () => {
    const env = createEnv(46);
    applyMigrations(env);
    seedPrerequisites(env);
    seedAllApprovalTypes(env);
    addMigration047(env);
    applyMigrations(env);

    const fixtureId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1";
    d1Exec(
      env,
      `
INSERT INTO approvals (
  id,
  request_type,
  status,
  customer_id,
  requested_by,
  reason,
  created_at,
  updated_at
) VALUES (
  '${fixtureId}',
  'link_family_customer',
  'pending',
  '${CUSTOMER_ID}',
  '${STAFF_ID}',
  'Family link fixture',
  '${NOW}',
  '${NOW}'
);
`.trim(),
    );

    const inserted = d1Query<{ request_type: string }>(
      env,
      `SELECT request_type FROM approvals WHERE id = '${fixtureId}';`,
    )[0];
    assert.equal(inserted?.request_type, "link_family_customer");

    d1Exec(env, `DELETE FROM approvals WHERE id = '${fixtureId}';`);

    const invalidInsert = wrangler(
      env,
      [
        "execute",
        "--command",
        `INSERT INTO approvals (
          id, request_type, status, customer_id, requested_by, reason, created_at, updated_at
        ) VALUES (
          'ffffffff-ffff-ffff-ffff-fffffffffff1',
          'not_a_real_approval_type',
          'pending',
          '${CUSTOMER_ID}',
          '${STAFF_ID}',
          'invalid',
          '${NOW}',
          '${NOW}'
        );`,
      ],
      { allowFailure: true },
    );
    assert.match(invalidInsert, /CHECK constraint failed/i);
  });

  it("still accepts all eight pre-existing request types after migration", () => {
    const env = createEnv(46);
    applyMigrations(env);
    seedPrerequisites(env);
    addMigration047(env);
    applyMigrations(env);

    for (const requestType of REQUEST_TYPES) {
      const id = `11111111-1111-1111-1111-${requestType.slice(0, 12).padEnd(12, "0")}`;
      d1Exec(
        env,
        `
INSERT INTO approvals (
  id, request_type, status, customer_id, requested_by, reason, created_at, updated_at
) VALUES (
  '${id}',
  '${requestType}',
  'pending',
  '${CUSTOMER_ID}',
  '${STAFF_ID}',
  'post-migration ${requestType}',
  '${NOW}',
  '${NOW}'
);
`.trim(),
      );
      const row = d1Query<{ request_type: string }>(
        env,
        `SELECT request_type FROM approvals WHERE id = '${id}';`,
      )[0];
      assert.equal(row?.request_type, requestType);
    }
  });
});
