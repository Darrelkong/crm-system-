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
import { getConfiguredMenuLeafKeys } from "@/lib/customer-sources/menu";
import { RETIRED_FORMAL_SOURCE_KEYS } from "@/lib/customer-sources/retired";
import {
  computeEligibleCustomSelectableKeys,
  computeSelectableCustomerSourceKeys,
} from "@/lib/customer-sources/keys";
import type { CustomerTagListItem } from "@/lib/customer-tags/queries";

const ROOT = process.cwd();
const ALL_MIGRATIONS_DIR = join(ROOT, "drizzle/migrations");
const cleanupDirs: string[] = [];

interface MigrationTestEnv {
  persistDir: string;
  migrationsDir: string;
  configPath: string;
}

interface TagRow extends Record<string, unknown> {
  tag_key: string;
  label: string;
  is_active: number;
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

function toTagListItem(row: TagRow): CustomerTagListItem {
  return {
    id: String(row.tag_key),
    tagKey: row.tag_key,
    label: row.label,
    isSystem: false,
    isActive: row.is_active === 1,
    sortOrder: 1,
  };
}

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("migration 0050 customer source menu (fresh D1)", () => {
  it("applies through 0050 and seeds only final formal menu tags", () => {
    const env = createEnv(50);
    const applyOutput = wrangler(env, ["migrations", "apply"]);
    assert.match(applyOutput, /0050_customer_source_menu_phase1\.sql/);

    const tags = d1Query<TagRow>(
      env,
      "SELECT tag_key, label, is_active FROM customer_tags ORDER BY tag_key;",
    );
    const tagKeys = new Set(tags.map((row) => row.tag_key));

    for (const key of getConfiguredMenuLeafKeys()) {
      assert.ok(tagKeys.has(key), `missing menu leaf tag ${key}`);
    }

    for (const key of RETIRED_FORMAL_SOURCE_KEYS) {
      assert.equal(
        tagKeys.has(key),
        false,
        `retired formal tag ${key} must not be seeded`,
      );
    }

    const onlineMedia = tags.find((row) => row.tag_key === "online_media");
    assert.ok(onlineMedia);
    assert.equal(onlineMedia.is_active, 0);
    assert.equal(onlineMedia.label, "其他媒体平台（历史未细分）");

    const taobao = tags.find((row) => row.tag_key === "xianyu_taobao");
    assert.ok(taobao);
    assert.equal(taobao.label, "淘宝");

    const activeMenuLeafCount = tags.filter(
      (row) => row.is_active === 1 && getConfiguredMenuLeafKeys().includes(row.tag_key),
    ).length;
    assert.equal(activeMenuLeafCount, getConfiguredMenuLeafKeys().length);

    const selectable = computeSelectableCustomerSourceKeys(tags.map(toTagListItem));
    for (const key of RETIRED_FORMAL_SOURCE_KEYS) {
      assert.equal(selectable.includes(key), false);
    }

    const customOnly = computeEligibleCustomSelectableKeys([
      ...tags.map(toTagListItem),
      {
        id: "custom-vip",
        tagKey: "vip_partner",
        label: "VIP 合作",
        isSystem: false,
        isActive: true,
        sortOrder: 1,
      },
      {
        id: "retired-weibo",
        tagKey: "weibo",
        label: "微博",
        isSystem: false,
        isActive: true,
        sortOrder: 1,
      },
    ]);
    assert.deepEqual(customOnly, ["vip_partner"]);
  });

  it("does not update customers.source", () => {
    const env = createEnv(50);
    wrangler(env, ["migrations", "apply"]);

    const customerSourceColumns = d1Query<{ name: string }>(
      env,
      "PRAGMA table_info(customers);",
    ).map((row) => row.name);

    assert.ok(customerSourceColumns.includes("source"));
    const migrationSql = readdirSync(ALL_MIGRATIONS_DIR)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => readFileSync(join(ALL_MIGRATIONS_DIR, file), "utf8"))
      .join("\n");
    assert.equal(
      migrationSql.toLowerCase().includes("update customers set source"),
      false,
    );
  });
});
