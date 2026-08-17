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
const cleanupDirs: string[] = [];

interface MigrationTestEnv {
  persistDir: string;
  migrationsDir: string;
  configPath: string;
}

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

function wrangler(env: MigrationTestEnv, subcommand: string[]): string {
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

  return execFileSync("npx", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
}

function d1Query<T extends Record<string, unknown>>(
  env: MigrationTestEnv,
  sql: string,
): T[] {
  const output = wrangler(env, ["execute", "--command", sql, "--json"]);
  const parsed = JSON.parse(output) as Array<{
    results: T[];
  }>;
  return parsed[0]?.results ?? [];
}

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("migration 0051 — customer entry_method", () => {
  it("applies fresh 0 → 0050 → 0051", () => {
    const env = createEnv(51);
    const applyOutput = wrangler(env, ["migrations", "apply"]);
    assert.match(applyOutput, /0050_customer_source_menu_phase1\.sql/);
    assert.match(applyOutput, /0051_customer_entry_method\.sql/);
  });

  it("adds nullable customers.entry_method without backfill SQL", () => {
    const env = createEnv(51);
    wrangler(env, ["migrations", "apply"]);

    const columns = d1Query<{ name: string; notnull: number }>(
      env,
      "PRAGMA table_info(customers);",
    );
    const entryMethod = columns.find((col) => col.name === "entry_method");
    assert.ok(entryMethod, "entry_method column must exist");
    assert.equal(entryMethod.notnull, 0, "entry_method must be nullable");

    const migrationSql = readFileSync(
      join(ALL_MIGRATIONS_DIR, "0051_customer_entry_method.sql"),
      "utf8",
    );
    assert.equal(/UPDATE\s+customers/i.test(migrationSql), false);
    assert.equal(/DELETE\s+FROM\s+customers/i.test(migrationSql), false);
  });

  it("does not change existing customer source values", () => {
    const env = createEnv(50);
    wrangler(env, ["migrations", "apply"]);

    wrangler(env, [
      "execute",
      "--command",
      `INSERT INTO users (
          id, email, display_name, role, is_active, password_hash,
          failed_login_attempts, must_change_password, created_at, updated_at
        ) VALUES (
          '00000000-0000-0000-0000-000000000001',
          'legacy-qe-user@crm.test.local',
          'Legacy QE User',
          'staff',
          1,
          'hash',
          0,
          0,
          datetime('now'),
          datetime('now')
        );`,
    ]);

    wrangler(env, [
      "execute",
      "--command",
      `INSERT INTO customers (
          id, customer_code, customer_name, name_status, customer_type,
          phone_country_code, source, sales_stage, status, created_by, updated_by,
          is_pinned, created_at, updated_at
        ) VALUES (
          'legacy-qe-customer', 'EF000099', '历史快录', 'confirmed', 'individual',
          '+86', 'public_pool_quick_entry', 'contacted', 'public_pool',
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000001',
          0, datetime('now'), datetime('now')
        );`,
    ]);

    cpSync(
      join(ALL_MIGRATIONS_DIR, "0051_customer_entry_method.sql"),
      join(env.migrationsDir, "0051_customer_entry_method.sql"),
    );
    wrangler(env, ["migrations", "apply"]);

    const rows = d1Query<{ source: string; entry_method: string | null }>(
      env,
      "SELECT source, entry_method FROM customers WHERE id = 'legacy-qe-customer';",
    );
    assert.equal(rows[0]?.source, "public_pool_quick_entry");
    assert.equal(rows[0]?.entry_method, null);
  });
});
