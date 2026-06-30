import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import {
  BACKUP_EXCLUDED_FIELDS,
  BACKUP_TABLE_NAMES,
} from "./constants";
import {
  collectBackupTableData,
  countBackupRecords,
} from "./export-data";

const NEW_BACKUP_TABLES = [
  "customer_assignees",
  "customer_tags",
  "customer_ai_insights",
  "announcements",
  "customer_code_counter",
  "login_ip_email_restrictions",
] as const;

const CORE_BACKUP_TABLES = [
  "customers",
  "follow_ups",
  "tasks",
  "approvals",
  "notifications",
  "audit_logs",
] as const;

describe("backup export table coverage", () => {
  it("includes newly added CRM tables", () => {
    for (const name of NEW_BACKUP_TABLES) {
      assert.equal(
        (BACKUP_TABLE_NAMES as readonly string[]).includes(name),
        true,
        `missing table: ${name}`,
      );
    }
  });

  it("includes core business tables", () => {
    for (const name of CORE_BACKUP_TABLES) {
      assert.equal(
        (BACKUP_TABLE_NAMES as readonly string[]).includes(name),
        true,
        `missing table: ${name}`,
      );
    }
  });

  it("does not include sessions table", () => {
    assert.equal(
      (BACKUP_TABLE_NAMES as readonly string[]).includes("sessions"),
      false,
    );
  });

  it("excludes users.password_hash from backup field policy", () => {
    assert.deepEqual(BACKUP_EXCLUDED_FIELDS.users, ["password_hash"]);
  });

  it("counts records across all backup tables", () => {
    const tables = Object.fromEntries(
      BACKUP_TABLE_NAMES.map((name) => [name, [{ id: "1" }]]),
    ) as Record<(typeof BACKUP_TABLE_NAMES)[number], { id: string }[]>;

    const counts = countBackupRecords(tables);
    assert.equal(counts.tableCount, BACKUP_TABLE_NAMES.length);
    assert.equal(counts.recordCount, BACKUP_TABLE_NAMES.length);
  });
});

describe(
  "collectBackupTableData integration",
  { skip: process.env.CRM_ALLOW_TEST_DB_BIND !== "1" },
  () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let dispose: (() => Promise<void>) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
  });

  after(async () => {
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("returns every configured backup table key", async () => {
    const tables = await collectBackupTableData(db);

    for (const name of BACKUP_TABLE_NAMES) {
      assert.ok(Array.isArray(tables[name]), `expected array for ${name}`);
    }

    assert.equal(
      "sessions" in tables,
      false,
      "sessions must not appear in backup payload",
    );
  });

  it("includes newly added tables in collected payload", async () => {
    const tables = await collectBackupTableData(db);

    for (const name of NEW_BACKUP_TABLES) {
      assert.ok(Array.isArray(tables[name]), `expected array for ${name}`);
    }
  });

  it("never exports users.password_hash or token_hash fields", async () => {
    const tables = await collectBackupTableData(db);

    for (const row of tables.users) {
      assert.equal("password_hash" in row, false);
      assert.equal("token_hash" in row, false);
    }
  });
  },
);
