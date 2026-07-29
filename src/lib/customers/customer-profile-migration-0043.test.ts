import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
      run: (...params: unknown[]) => unknown;
      get: (...params: unknown[]) => unknown;
      all: (...params: unknown[]) => unknown[];
    };
    close: () => void;
  };
};

const SQL_0043 = readFileSync(
  "drizzle/migrations/0043_add_customer_profile_fields.sql",
  "utf8",
);

const PROFILE_COLUMNS = [
  "preferred_name",
  "gender",
  "age_range",
  "preferred_language",
  "preferred_contact_method",
  "occupation",
  "company_name",
  "job_title",
  "target_country_or_region",
  "primary_concern",
] as const;

describe("Migration 0043 customer profile fields", () => {
  it("only adds nullable TEXT columns without rebuild / defaults / indexes", () => {
    const sqlOnly = SQL_0043
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    for (const column of PROFILE_COLUMNS) {
      assert.match(
        sqlOnly,
        new RegExp(`ALTER TABLE customers ADD COLUMN ${column} TEXT;`),
      );
    }
    assert.doesNotMatch(sqlOnly, /DROP TABLE/i);
    assert.doesNotMatch(sqlOnly, /CREATE TABLE/i);
    assert.doesNotMatch(sqlOnly, /CREATE INDEX/i);
    assert.doesNotMatch(sqlOnly, /CREATE TRIGGER/i);
    assert.doesNotMatch(sqlOnly, /DEFAULT/i);
    assert.doesNotMatch(sqlOnly, /NOT NULL/i);
    assert.doesNotMatch(sqlOnly, /CHECK\s*\(/i);
    assert.doesNotMatch(sqlOnly, /UPDATE /i);
    assert.doesNotMatch(sqlOnly, /DELETE FROM/i);
  });

  it("applies after a minimal customers table and leaves old rows NULL", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE customers (
        id TEXT PRIMARY KEY NOT NULL,
        customer_name TEXT NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO customers (id, customer_name) VALUES (?, ?)`,
    ).run("c1", "舊客戶");

    db.exec(SQL_0043);

    const cols = db
      .prepare(`PRAGMA table_info(customers)`)
      .all() as Array<{ name: string; notnull: number; dflt_value: unknown }>;
    const byName = new Map(cols.map((c) => [c.name, c]));

    for (const column of PROFILE_COLUMNS) {
      const info = byName.get(column);
      assert.ok(info, `missing column ${column}`);
      assert.equal(info.notnull, 0);
      assert.equal(info.dflt_value, null);
    }

    const row = db
      .prepare(
        `SELECT preferred_name, gender, age_range, preferred_language,
                preferred_contact_method, occupation, company_name, job_title,
                target_country_or_region, primary_concern
         FROM customers WHERE id = ?`,
      )
      .get("c1") as Record<string, unknown>;

    for (const column of PROFILE_COLUMNS) {
      assert.equal(row[column], null);
    }

    const count = db.prepare(`SELECT COUNT(*) AS n FROM customers`).get() as {
      n: number;
    };
    assert.equal(count.n, 1);
    db.close();
  });
});
