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

const SQL_0046 = readFileSync(
  "drizzle/migrations/0046_customer_households_foundation.sql",
  "utf8",
);

function createPrerequisiteTables(db: InstanceType<typeof DatabaseSync>) {
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY NOT NULL
    );
    CREATE TABLE customers (
      id TEXT PRIMARY KEY NOT NULL,
      customer_name TEXT NOT NULL
    );
  `);
  db.prepare(`INSERT INTO users (id) VALUES (?)`).run("u1");
  db.prepare(`INSERT INTO customers (id, customer_name) VALUES (?, ?)`).run(
    "c-a",
    "Customer A",
  );
  db.prepare(`INSERT INTO customers (id, customer_name) VALUES (?, ?)`).run(
    "c-b",
    "Customer B",
  );
}

describe("Migration 0046 customer households foundation", () => {
  it("is additive only — creates three new tables without altering existing tables", () => {
    const ddl = SQL_0046.split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    assert.match(ddl, /CREATE TABLE customer_households/);
    assert.match(ddl, /CREATE TABLE customer_household_members/);
    assert.match(ddl, /CREATE TABLE customer_household_relationships/);
    assert.doesNotMatch(ddl, /DROP TABLE/i);
    assert.doesNotMatch(ddl, /ALTER TABLE customers/i);
    assert.doesNotMatch(ddl, /ALTER TABLE customer_contacts/i);
    assert.doesNotMatch(ddl, /INSERT INTO/i);
    assert.doesNotMatch(ddl, /CREATE TRIGGER/i);
  });

  it("defines partial unique index for one active household per customer", () => {
    assert.match(
      SQL_0046,
      /CREATE UNIQUE INDEX uq_customer_household_members_customer_active[\s\S]*WHERE left_at IS NULL/,
    );
  });

  it("applies on a clean database with prerequisite users/customers tables", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    createPrerequisiteTables(db);

    const customerCountBefore = (
      db.prepare(`SELECT COUNT(*) AS n FROM customers`).get() as { n: number }
    ).n;

    db.exec(SQL_0046);

    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'customer_household%' ORDER BY name`,
      )
      .all() as Array<{ name: string }>;
    assert.deepEqual(
      tables.map((t) => t.name),
      [
        "customer_household_members",
        "customer_household_relationships",
        "customer_households",
      ],
    );

    const customerCountAfter = (
      db.prepare(`SELECT COUNT(*) AS n FROM customers`).get() as { n: number }
    ).n;
    assert.equal(customerCountAfter, customerCountBefore);
    db.close();
  });

  it("rejects a second active household membership for the same customer", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    createPrerequisiteTables(db);
    db.exec(SQL_0046);

    const now = "2026-08-12T00:00:00.000Z";
    db.prepare(
      `INSERT INTO customer_households
        (id, status, created_by, created_at, updated_at)
       VALUES (?, 'active', ?, ?, ?)`,
    ).run("hh-1", "u1", now, now);
    db.prepare(
      `INSERT INTO customer_households
        (id, status, created_by, created_at, updated_at)
       VALUES (?, 'active', ?, ?, ?)`,
    ).run("hh-2", "u1", now, now);

    const insertMember = db.prepare(
      `INSERT INTO customer_household_members
        (id, household_id, customer_id, joined_at, joined_by)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insertMember.run("hm-1", "hh-1", "c-a", now, "u1");

    assert.throws(() => {
      insertMember.run("hm-2", "hh-2", "c-a", now, "u1");
    });

    db.close();
  });

  it("allows a new active membership after the prior membership is historical", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    createPrerequisiteTables(db);
    db.exec(SQL_0046);

    const now = "2026-08-12T00:00:00.000Z";
    db.prepare(
      `INSERT INTO customer_households (id, status, created_by, created_at, updated_at)
       VALUES ('hh-1', 'active', 'u1', ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO customer_households (id, status, created_by, created_at, updated_at)
       VALUES ('hh-2', 'active', 'u1', ?, ?)`,
    ).run(now, now);

    const insertMember = db.prepare(
      `INSERT INTO customer_household_members
        (id, household_id, customer_id, joined_at, joined_by, left_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertMember.run("hm-1", "hh-1", "c-a", now, "u1", null);
    db.prepare(
      `UPDATE customer_household_members SET left_at = ? WHERE id = ?`,
    ).run("2026-08-13T00:00:00.000Z", "hm-1");

    insertMember.run("hm-2", "hh-2", "c-a", now, "u1", null);
    db.close();
  });

  it("rejects self-directed relationships", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    createPrerequisiteTables(db);
    db.exec(SQL_0046);

    const now = "2026-08-12T00:00:00.000Z";
    db.prepare(
      `INSERT INTO customer_households (id, status, created_by, created_at, updated_at)
       VALUES ('hh-1', 'active', 'u1', ?, ?)`,
    ).run(now, now);

    assert.throws(() => {
      db.prepare(
        `INSERT INTO customer_household_relationships
          (id, household_id, from_customer_id, to_customer_id, relationship_type, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'father', ?, ?, ?)`,
      ).run("hr-self", "hh-1", "c-a", "c-a", "u1", now, now);
    });

    db.close();
  });

  it("rejects duplicate directed relationships in the same household", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    createPrerequisiteTables(db);
    db.exec(SQL_0046);

    const now = "2026-08-12T00:00:00.000Z";
    db.prepare(
      `INSERT INTO customer_households (id, status, created_by, created_at, updated_at)
       VALUES ('hh-1', 'active', 'u1', ?, ?)`,
    ).run(now, now);

    const insertRel = db.prepare(
      `INSERT INTO customer_household_relationships
        (id, household_id, from_customer_id, to_customer_id, relationship_type, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'father', ?, ?, ?)`,
    );
    insertRel.run("hr-1", "hh-1", "c-a", "c-b", "u1", now, now);

    assert.throws(() => {
      insertRel.run("hr-2", "hh-1", "c-a", "c-b", "u1", now, now);
    });

    db.close();
  });

  it("sets created_from_customer_id to NULL when provenance customer is deleted", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    createPrerequisiteTables(db);
    db.exec(SQL_0046);

    const now = "2026-08-12T00:00:00.000Z";
    db.prepare(
      `INSERT INTO customer_households
        (id, status, created_from_customer_id, created_by, created_at, updated_at)
       VALUES ('hh-1', 'active', 'c-a', 'u1', ?, ?)`,
    ).run(now, now);

    db.prepare(`DELETE FROM customers WHERE id = ?`).run("c-a");

    const row = db
      .prepare(
        `SELECT created_from_customer_id AS provenance FROM customer_households WHERE id = ?`,
      )
      .get("hh-1") as { provenance: string | null };
    assert.equal(row.provenance, null);

    const householdCount = db
      .prepare(`SELECT COUNT(*) AS n FROM customer_households`)
      .get() as { n: number };
    assert.equal(householdCount.n, 1);

    db.close();
  });
});
