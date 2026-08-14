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
const SQL_0049 = readFileSync(
  join(ALL_MIGRATIONS_DIR, "0049_priority_customer_foundation.sql"),
  "utf8",
);

const ADMIN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const STAFF_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
const CUSTOMER_A_ID = "cccccccc-cccc-cccc-cccc-cccccccccca1";
const CUSTOMER_B_ID = "cccccccc-cccc-cccc-cccc-cccccccccca2";
const CUSTOMER_C_ID = "cccccccc-cccc-cccc-cccc-cccccccccca3";
const CUSTOMER_D_ID = "cccccccc-cccc-cccc-cccc-cccccccccca4";
const PINNED_AT_A = "2026-07-01T08:00:00.000Z";
const PINNED_AT_B = "2026-07-02T09:00:00.000Z";
const NOW = "2026-08-14T10:00:00.000Z";

const EXISTING_REQUEST_TYPES = [
  "delete_customer",
  "transfer_customer",
  "merge_customers",
  "closed_won",
  "second_conversion",
  "create_on_hold_customer",
  "update_customer_assignees",
  "paid_customer",
  "link_family_customer",
  "update_family_relationship",
  "unlink_family_customer",
] as const;

const NEW_REQUEST_TYPES = [
  "set_priority_customer",
  "unset_priority_customer",
] as const;

const EXPECTED_INDEXES = [
  "idx_approvals_status",
  "idx_approvals_customer_id",
  "idx_approvals_requested_by",
  "idx_approvals_pending_lookup",
] as const;

const PINNED_SOURCE_VALUES = [
  null,
  "on_hold_auto",
  "admin_direct",
  "approval",
  "legacy",
] as const;

interface MigrationTestEnv {
  persistDir: string;
  migrationsDir: string;
  configPath: string;
}

interface ApprovalRow extends Record<string, unknown> {
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

interface CustomerRow extends Record<string, unknown> {
  id: string;
  is_pinned: number;
  sales_stage: string | null;
  pinned_at: string | null;
  pinned_source?: string | null;
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

function addMigration049(env: MigrationTestEnv): void {
  cpSync(
    join(ALL_MIGRATIONS_DIR, "0049_priority_customer_foundation.sql"),
    join(env.migrationsDir, "0049_priority_customer_foundation.sql"),
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
`.trim(),
  );
}

function seedPinnedCustomers(env: MigrationTestEnv): void {
  d1Exec(
    env,
    `
INSERT INTO customers (
  id, customer_name, source, sales_stage, owner_id, status,
  is_pinned, pinned_at, created_by, updated_by, created_at, updated_at
) VALUES
  (
    '${CUSTOMER_A_ID}', 'Pinned On Hold', 'referral', 'on_hold',
    '${STAFF_ID}', 'active', 1, '${PINNED_AT_A}',
    '${STAFF_ID}', '${STAFF_ID}', '${NOW}', '${NOW}'
  ),
  (
    '${CUSTOMER_B_ID}', 'Pinned Negotiation', 'referral', 'negotiation',
    '${STAFF_ID}', 'active', 1, '${PINNED_AT_B}',
    '${STAFF_ID}', '${STAFF_ID}', '${NOW}', '${NOW}'
  ),
  (
    '${CUSTOMER_C_ID}', 'Unpinned', 'referral', 'new_lead',
    '${STAFF_ID}', 'active', 0, NULL,
    '${STAFF_ID}', '${STAFF_ID}', '${NOW}', '${NOW}'
  ),
  (
    '${CUSTOMER_D_ID}', 'Unpinned On Hold', 'referral', 'on_hold',
    '${STAFF_ID}', 'active', 0, NULL,
    '${STAFF_ID}', '${STAFF_ID}', '${NOW}', '${NOW}'
  );
`.trim(),
  );
}

function seedAllApprovalTypes(env: MigrationTestEnv): void {
  const statuses = ["pending", "approved", "rejected"] as const;
  const values = EXISTING_REQUEST_TYPES.map((requestType, index) => {
    const status = statuses[index % statuses.length];
    const id = `dddddddd-dddd-dddd-dddd-${String(index + 1).padStart(12, "0")}`;
    const reviewed =
      status === "pending" ? "NULL, NULL" : `'${ADMIN_ID}', '${NOW}'`;
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
      '${CUSTOMER_A_ID}',
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

function readCustomer(
  env: MigrationTestEnv,
  id: string,
  options: { includePinnedSource?: boolean } = {},
): CustomerRow {
  const columns = options.includePinnedSource
    ? "id, is_pinned, sales_stage, pinned_at, pinned_source"
    : "id, is_pinned, sales_stage, pinned_at";
  const row = d1Query<CustomerRow>(
    env,
    `SELECT ${columns}
     FROM customers
     WHERE id = '${id}';`,
  )[0];
  assert.ok(row, `missing customer ${id}`);
  return row;
}

function groupedCounts(
  env: MigrationTestEnv,
): Array<{ request_type: string; status: string; count: number }> {
  return d1Query<{ request_type: string; status: string; count: number }>(
    env,
    `SELECT request_type, status, COUNT(*) AS count
     FROM approvals
     GROUP BY request_type, status
     ORDER BY request_type, status;`,
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

describe("Migration 0049 priority customer foundation", () => {
  it("uses additive customers ALTER and approvals rebuild pattern", () => {
    const ddl = SQL_0049.split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    assert.match(ddl, /ALTER TABLE customers ADD COLUMN pinned_source/i);
    assert.match(ddl, /'legacy'/);
    assert.match(ddl, /CREATE TABLE approvals_new/);
    assert.match(ddl, /INSERT INTO approvals_new[\s\S]*SELECT[\s\S]*FROM approvals/);
    assert.match(ddl, /DROP TABLE approvals/);
    assert.match(ddl, /ALTER TABLE approvals_new RENAME TO approvals/);
    assert.match(ddl, /'set_priority_customer'/);
    assert.match(ddl, /'unset_priority_customer'/);
    for (const requestType of EXISTING_REQUEST_TYPES) {
      assert.match(ddl, new RegExp(`'${requestType}'`));
    }
    assert.doesNotMatch(ddl, /customer_household/i);
    assert.doesNotMatch(ddl, /CREATE TABLE customers/i);
  });

  it("applies on a clean database through the full migration chain", () => {
    const env = createEnv();
    const output = applyMigrations(env);
    assert.match(output, /0049_priority_customer_foundation\.sql/);

    const customerColumns = d1Query<{ name: string }>(
      env,
      `SELECT name FROM pragma_table_info('customers') WHERE name = 'pinned_source';`,
    );
    assert.equal(customerColumns.length, 1);

    const approvalsDdl = d1Query<{ sql: string }>(
      env,
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='approvals';`,
    )[0]?.sql;
    assert.match(approvalsDdl ?? "", /'set_priority_customer'/);
    assert.match(approvalsDdl ?? "", /'unset_priority_customer'/);

    assertIndexes(env);
    assertForeignKeys(env);

    const tempTable = d1Query<{ name: string }>(
      env,
      `SELECT name FROM sqlite_master WHERE type='table' AND name='approvals_new';`,
    );
    assert.equal(tempTable.length, 0);
  });

  it("backfills pinned_source=legacy without inferring from sales_stage", () => {
    const env = createEnv(48);
    applyMigrations(env);
    seedPrerequisites(env);
    seedPinnedCustomers(env);

    const beforeA = readCustomer(env, CUSTOMER_A_ID);
    const beforeB = readCustomer(env, CUSTOMER_B_ID);
    const beforeC = readCustomer(env, CUSTOMER_C_ID);
    const beforeD = readCustomer(env, CUSTOMER_D_ID);

    addMigration049(env);
    applyMigrations(env);

    const afterA = readCustomer(env, CUSTOMER_A_ID, { includePinnedSource: true });
    const afterB = readCustomer(env, CUSTOMER_B_ID, { includePinnedSource: true });
    const afterC = readCustomer(env, CUSTOMER_C_ID, { includePinnedSource: true });
    const afterD = readCustomer(env, CUSTOMER_D_ID, { includePinnedSource: true });

    assert.equal(afterA.is_pinned, beforeA.is_pinned);
    assert.equal(afterA.sales_stage, beforeA.sales_stage);
    assert.equal(afterA.pinned_at, beforeA.pinned_at);
    assert.equal(afterA.pinned_source, "legacy");

    assert.equal(afterB.is_pinned, beforeB.is_pinned);
    assert.equal(afterB.sales_stage, beforeB.sales_stage);
    assert.equal(afterB.pinned_at, beforeB.pinned_at);
    assert.equal(afterB.pinned_source, "legacy");

    assert.equal(afterC.is_pinned, 0);
    assert.equal(afterC.pinned_source, null);

    assert.equal(afterD.is_pinned, 0);
    assert.equal(afterD.sales_stage, "on_hold");
    assert.equal(afterD.pinned_source, null);
  });

  it("accepts pinned_source CHECK values and rejects invalid source", () => {
    const env = createEnv();
    applyMigrations(env);
    seedPrerequisites(env);
    seedPinnedCustomers(env);

    for (const value of PINNED_SOURCE_VALUES) {
      const sourceSql =
        value === null ? "NULL" : `'${value}'`;
      d1Exec(
        env,
        `
UPDATE customers
SET pinned_source = ${sourceSql}
WHERE id = '${CUSTOMER_C_ID}';
`.trim(),
      );
      const row = readCustomer(env, CUSTOMER_C_ID, { includePinnedSource: true });
      assert.equal(row.pinned_source, value);
    }

    const invalidUpdate = wrangler(
      env,
      [
        "execute",
        "--command",
        `UPDATE customers SET pinned_source = 'random_priority_source' WHERE id = '${CUSTOMER_C_ID}';`,
      ],
      { allowFailure: true },
    );
    assert.match(invalidUpdate, /CHECK constraint failed/i);
  });

  it("upgrades from 0048 while preserving existing approval rows exactly", () => {
    const env = createEnv(48);
    applyMigrations(env);
    seedPrerequisites(env);
    seedPinnedCustomers(env);
    seedAllApprovalTypes(env);

    const beforeRows = readApprovals(env);
    const beforeGrouped = groupedCounts(env);
    assert.equal(beforeRows.length, EXISTING_REQUEST_TYPES.length);

    addMigration049(env);
    applyMigrations(env);

    const afterRows = readApprovals(env);
    const afterGrouped = groupedCounts(env);
    assert.deepEqual(afterRows, beforeRows);
    assert.deepEqual(afterGrouped, beforeGrouped);

    const count = d1Query<{ n: number }>(
      env,
      "SELECT COUNT(*) AS n FROM approvals;",
    )[0]?.n;
    assert.equal(count, EXISTING_REQUEST_TYPES.length);

    const distinctIds = d1Query<{ n: number }>(
      env,
      "SELECT COUNT(DISTINCT id) AS n FROM approvals;",
    )[0]?.n;
    assert.equal(distinctIds, EXISTING_REQUEST_TYPES.length);

    assertIndexes(env);
    assertForeignKeys(env);
  });

  it("accepts new priority approval types and rejects invalid request types", () => {
    const env = createEnv(48);
    applyMigrations(env);
    seedPrerequisites(env);
    seedPinnedCustomers(env);
    addMigration049(env);
    applyMigrations(env);

    for (const requestType of NEW_REQUEST_TYPES) {
      const fixtureId = `eeeeeeee-eeee-eeee-eeee-${requestType.slice(0, 12).padEnd(12, "0")}`;
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
  '${requestType}',
  'pending',
  '${CUSTOMER_A_ID}',
  '${STAFF_ID}',
  'Priority fixture ${requestType}',
  '${NOW}',
  '${NOW}'
);
`.trim(),
      );

      const inserted = d1Query<{ request_type: string }>(
        env,
        `SELECT request_type FROM approvals WHERE id = '${fixtureId}';`,
      )[0];
      assert.equal(inserted?.request_type, requestType);
      d1Exec(env, `DELETE FROM approvals WHERE id = '${fixtureId}';`);
    }

    const invalidInsert = wrangler(
      env,
      [
        "execute",
        "--command",
        `INSERT INTO approvals (
          id, request_type, status, customer_id, requested_by, reason, created_at, updated_at
        ) VALUES (
          'ffffffff-ffff-ffff-ffff-fffffffffff1',
          'random_priority_action',
          'pending',
          '${CUSTOMER_A_ID}',
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

  it("still accepts all eleven pre-existing request types after migration", () => {
    const env = createEnv(48);
    applyMigrations(env);
    seedPrerequisites(env);
    seedPinnedCustomers(env);
    addMigration049(env);
    applyMigrations(env);

    for (const requestType of EXISTING_REQUEST_TYPES) {
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
  '${CUSTOMER_A_ID}',
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
