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

/**
 * Migration 0041 — customer_contact_identifiers foundation.
 * In-memory SQLite only (no --remote / shared D1).
 */
describe("Migration 0041 create customer_contact_identifiers", () => {
  const sql = readFileSync(
    "drizzle/migrations/0041_create_customer_contact_identifiers.sql",
    "utf8",
  );

  it("creates table with per-customer unique only (no global unique)", () => {
    assert.match(sql, /CREATE TABLE customer_contact_identifiers/);
    assert.match(
      sql,
      /UNIQUE INDEX uq_customer_contact_identifiers_customer_type_value/,
    );
    assert.match(
      sql,
      /ON customer_contact_identifiers \(customer_id, contact_type, normalized_value\)/,
    );
    assert.match(
      sql,
      /INDEX idx_customer_contact_identifiers_customer_id/,
    );
    assert.match(
      sql,
      /contact_type IN \('phone', 'wechat_id', 'email'\)/,
    );
    assert.match(sql, /REFERENCES customers \(id\) ON DELETE CASCADE/);
    // Strip SQL comments before asserting absence of global unique DDL.
    const ddl = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    assert.doesNotMatch(
      ddl,
      /UNIQUE\s*\(\s*contact_type\s*,\s*normalized_value\s*\)/i,
    );
    assert.doesNotMatch(
      ddl,
      /UNIQUE INDEX[^\n]*\(contact_type,\s*normalized_value\)/i,
    );
    assert.doesNotMatch(sql, /CREATE TRIGGER/i);
    assert.doesNotMatch(sql, /ALTER TABLE customers/i);
    assert.doesNotMatch(sql, /customer_contacts/i);
  });

  it("enforces schema rules in isolated sqlite", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");

    db.exec(`
      CREATE TABLE customers (
        id TEXT PRIMARY KEY NOT NULL,
        customer_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );
    `);
    db.exec(sql);

    const now = "2026-07-29T00:00:00.000Z";
    db.prepare(
      `INSERT INTO customers (id, customer_name, status) VALUES (?, ?, ?)`,
    ).run("c1", "A", "active");
    db.prepare(
      `INSERT INTO customers (id, customer_name, status) VALUES (?, ?, ?)`,
    ).run("c2", "B", "archived");

    const insert = db.prepare(
      `INSERT INTO customer_contact_identifiers
        (id, customer_id, contact_type, normalized_value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    insert.run("i1", "c1", "phone", "+8613800138000", now, now);
    insert.run("i2", "c1", "email", "a@example.com", now, now);
    insert.run("i3", "c2", "phone", "+8613800138000", now, now); // cross-customer OK in 0041

    assert.throws(() => {
      insert.run("i4", "c1", "phone", "+8613800138000", now, now);
    });

    assert.throws(() => {
      insert.run("i5", "c1", "sms", "x", now, now);
    });

    const cols = db
      .prepare(`PRAGMA table_info(customer_contact_identifiers)`)
      .all() as Array<{ name: string }>;
    assert.deepEqual(
      cols.map((c) => c.name),
      [
        "id",
        "customer_id",
        "contact_type",
        "normalized_value",
        "created_at",
        "updated_at",
      ],
    );

    const indexes = db
      .prepare(`PRAGMA index_list(customer_contact_identifiers)`)
      .all() as Array<{ name: string; unique: number }>;
    const names = indexes.map((i) => i.name).sort();
    assert.ok(
      names.includes("uq_customer_contact_identifiers_customer_type_value"),
    );
    assert.ok(names.includes("idx_customer_contact_identifiers_customer_id"));

    const triggers = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='customer_contact_identifiers'`,
      )
      .all();
    assert.equal(triggers.length, 0);

    db.prepare(`DELETE FROM customers WHERE id = ?`).run("c1");
    const left = db
      .prepare(
        `SELECT COUNT(*) AS n FROM customer_contact_identifiers WHERE customer_id = ?`,
      )
      .get("c1") as { n: number };
    assert.equal(left.n, 0);

    const archivedKept = db
      .prepare(
        `SELECT COUNT(*) AS n FROM customer_contact_identifiers WHERE customer_id = ?`,
      )
      .get("c2") as { n: number };
    assert.equal(archivedKept.n, 1);

    const otherTables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('customers', 'customer_contact_identifiers')`,
      )
      .all();
    assert.equal(otherTables.length, 0);

    db.close();
  });
});
