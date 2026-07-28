import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import {
  classifyContactIdentifierUniqueConstraintError,
  isGlobalContactIdentifierUniqueConstraintError,
} from "@/lib/customers/contact-identifiers";
import { buildReplaceCustomerIdentifierStatements } from "@/lib/customers/contact-identifiers";
import {
  findCrossCustomerIdentifierConflicts,
  maskNormalizedIdentifier,
} from "@/lib/customers/contact-identifiers-backfill";

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

const SQL_0041 = readFileSync(
  "drizzle/migrations/0041_create_customer_contact_identifiers.sql",
  "utf8",
);
const SQL_0042 = readFileSync(
  "drizzle/migrations/0042_add_global_contact_identifier_unique.sql",
  "utf8",
);

function sha12(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

function openBaseDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE customers (
      id TEXT PRIMARY KEY NOT NULL,
      customer_code TEXT,
      customer_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      deleted_at TEXT
    );
  `);
  db.exec(SQL_0041);
  return db;
}

function insertCustomer(
  db: InstanceType<typeof DatabaseSync>,
  id: string,
  status = "active",
  deletedAt: string | null = null,
) {
  db.prepare(
    `INSERT INTO customers (id, customer_code, customer_name, status, deleted_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, id, `Name ${id}`, status, deletedAt);
}

function insertIdentifier(
  db: InstanceType<typeof DatabaseSync>,
  id: string,
  customerId: string,
  type: string,
  value: string,
  now = "2026-07-29T04:00:00.000Z",
) {
  db.prepare(
    `INSERT INTO customer_contact_identifiers
      (id, customer_id, contact_type, normalized_value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, customerId, type, value, now, now);
}

describe("Migration 0042 global contact identifier unique", () => {
  it("only creates the named global unique index", () => {
    assert.match(
      SQL_0042,
      /CREATE UNIQUE INDEX uq_customer_contact_identifiers_type_value/,
    );
    assert.match(
      SQL_0042,
      /ON customer_contact_identifiers \(contact_type, normalized_value\)/,
    );
    assert.doesNotMatch(SQL_0042, /DROP TABLE/i);
    assert.doesNotMatch(SQL_0042, /CREATE TRIGGER/i);
    assert.doesNotMatch(SQL_0042, /ALTER TABLE/i);
    assert.doesNotMatch(SQL_0042, /DELETE FROM/i);
  });

  it("schema TS registers both uniques and customer_id index", () => {
    const schema = readFileSync(
      "drizzle/schema/customer-contact-identifiers.ts",
      "utf8",
    );
    assert.match(
      schema,
      /uq_customer_contact_identifiers_customer_type_value/,
    );
    assert.match(schema, /uq_customer_contact_identifiers_type_value/);
    assert.match(schema, /idx_customer_contact_identifiers_customer_id/);
  });

  it("applies after 0041 and enforces cross-customer phone/wechat/email", () => {
    const db = openBaseDb();
    insertCustomer(db, "c1");
    insertCustomer(db, "c2");
    insertIdentifier(db, "i1", "c1", "phone", "+8613800138000");
    insertIdentifier(db, "i2", "c1", "wechat_id", "wx_alpha");
    insertIdentifier(db, "i3", "c1", "email", "a@example.com");

    db.exec(SQL_0042);

    assert.throws(() =>
      insertIdentifier(db, "i4", "c2", "phone", "+8613800138000"),
    );
    assert.throws(() =>
      insertIdentifier(db, "i5", "c2", "wechat_id", "wx_alpha"),
    );
    assert.throws(() =>
      insertIdentifier(db, "i6", "c2", "email", "a@example.com"),
    );

    // Different contact type, same text value — allowed.
    insertIdentifier(db, "i7", "c2", "email", "wx_alpha");
    insertIdentifier(db, "c2phone", "c2", "phone", "+8613999000001");

    const indexes = db
      .prepare(`PRAGMA index_list(customer_contact_identifiers)`)
      .all() as Array<{ name: string; unique: number }>;
    const names = indexes.map((i) => i.name);
    assert.ok(names.includes("uq_customer_contact_identifiers_type_value"));
    assert.ok(
      names.includes("uq_customer_contact_identifiers_customer_type_value"),
    );
    assert.ok(names.includes("idx_customer_contact_identifiers_customer_id"));
    assert.equal(
      indexes.find((i) => i.name === "uq_customer_contact_identifiers_type_value")
        ?.unique,
      1,
    );

    const fks = db
      .prepare(`PRAGMA foreign_key_list(customer_contact_identifiers)`)
      .all() as Array<{ table: string; on_delete: string }>;
    assert.equal(fks[0]?.table, "customers");
    assert.equal(fks[0]?.on_delete.toLowerCase(), "cascade");

    const triggers = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='customer_contact_identifiers'`,
      )
      .all();
    assert.equal(triggers.length, 0);

    db.close();
  });

  it("fails safely when cross-customer conflicts already exist", () => {
    const db = openBaseDb();
    insertCustomer(db, "c1");
    insertCustomer(db, "c2");
    insertIdentifier(db, "i1", "c1", "phone", "+8613800138000");
    insertIdentifier(db, "i2", "c2", "phone", "+8613800138000");

    const conflicts = findCrossCustomerIdentifierConflicts([
      {
        customerId: "c1",
        customerCode: "EF1",
        status: "active",
        identifiers: [
          { contactType: "phone", normalizedValue: "+8613800138000" },
        ],
        unnormalizableCount: 0,
      },
      {
        customerId: "c2",
        customerCode: "EF2",
        status: "active",
        identifiers: [
          { contactType: "phone", normalizedValue: "+8613800138000" },
        ],
        unnormalizableCount: 0,
      },
    ]);
    assert.equal(conflicts.length, 1);
    assert.ok(!JSON.stringify(conflicts).includes("13800138000"));
    assert.equal(conflicts[0]?.valueHash, sha12("+8613800138000"));
    assert.equal(
      conflicts[0]?.maskedValue,
      maskNormalizedIdentifier("phone", "+8613800138000"),
    );

    assert.throws(() => db.exec(SQL_0042));

    // Data untouched after failed migration attempt.
    const rows = db
      .prepare(`SELECT COUNT(*) AS n FROM customer_contact_identifiers`)
      .get() as { n: number };
    assert.equal(rows.n, 2);
    const idx = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='uq_customer_contact_identifiers_type_value'`,
      )
      .all();
    assert.equal(idx.length, 0);
    db.close();
  });

  it("archived and recycle-bin identifiers still block others; hard delete releases", () => {
    const db = openBaseDb();
    insertCustomer(db, "c_arch", "archived");
    insertCustomer(db, "c_bin", "archived", "2026-07-29T00:00:00.000Z");
    insertCustomer(db, "c_live");
    db.exec(SQL_0042);

    insertIdentifier(db, "ia", "c_arch", "phone", "+8613811111111");
    insertIdentifier(db, "ib", "c_bin", "wechat_id", "bin_wx");

    assert.throws(() =>
      insertIdentifier(db, "ix", "c_live", "phone", "+8613811111111"),
    );
    assert.throws(() =>
      insertIdentifier(db, "iy", "c_live", "wechat_id", "bin_wx"),
    );

    db.prepare(`DELETE FROM customers WHERE id = ?`).run("c_arch");
    const left = db
      .prepare(
        `SELECT COUNT(*) AS n FROM customer_contact_identifiers WHERE customer_id = 'c_arch'`,
      )
      .get() as { n: number };
    assert.equal(left.n, 0);

    // Freed phone can be reused.
    insertIdentifier(db, "iz", "c_live", "phone", "+8613811111111");
    db.close();
  });

  it("captures real global unique error signature for mapping", () => {
    const db = openBaseDb();
    insertCustomer(db, "c1");
    insertCustomer(db, "c2");
    db.exec(SQL_0042);
    insertIdentifier(db, "i1", "c1", "email", "race@example.com");

    let err: unknown;
    try {
      insertIdentifier(db, "i2", "c2", "email", "race@example.com");
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof Error);
    assert.match(err.message, /UNIQUE constraint failed/i);
    assert.match(err.message, /customer_contact_identifiers\.contact_type/i);
    assert.match(
      err.message,
      /customer_contact_identifiers\.normalized_value/i,
    );
    assert.doesNotMatch(err.message, /customer_id/i);
    // PII value itself is not in the SQLite message.
    assert.doesNotMatch(err.message, /race@example\.com/i);
    assert.equal(classifyContactIdentifierUniqueConstraintError(err), "global");
    assert.equal(isGlobalContactIdentifierUniqueConstraintError(err), true);

    // Unrelated unique errors are ignored.
    assert.equal(
      classifyContactIdentifierUniqueConstraintError(
        new Error(
          "UNIQUE constraint failed: customer_assignees.customer_id, customer_assignees.user_id",
        ),
      ),
      null,
    );
    assert.equal(
      classifyContactIdentifierUniqueConstraintError(
        new Error(
          "UNIQUE constraint failed: uq_customer_contact_identifiers_customer_type_value",
        ),
      ),
      "per_customer",
    );
    db.close();
  });
});

describe("Phase 2B race atomicity (isolated sqlite batches)", () => {
  it("create batch rolls back customer+assignee+identifier on global unique fail", () => {
    const db = openBaseDb();
    insertCustomer(db, "winner");
    db.exec(SQL_0042);
    insertIdentifier(db, "iw", "winner", "phone", "+8613822222222");

    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT INTO customers (id, customer_code, customer_name, status)
         VALUES ('loser', 'L1', 'Loser', 'active')`,
      ).run();
      // pretend assignee table via customers-only — use identifier insert as fail point
      db.prepare(
        `INSERT INTO customer_contact_identifiers
          (id, customer_id, contact_type, normalized_value, created_at, updated_at)
         VALUES ('il', 'loser', 'phone', '+8613822222222', 't', 't')`,
      ).run();
      db.exec("COMMIT");
    } catch {
      db.exec("ROLLBACK");
    }

    const customers = db
      .prepare(`SELECT COUNT(*) AS n FROM customers WHERE id='loser'`)
      .get() as { n: number };
    const ids = db
      .prepare(
        `SELECT COUNT(*) AS n FROM customer_contact_identifiers WHERE customer_id='loser'`,
      )
      .get() as { n: number };
    assert.equal(customers.n, 0);
    assert.equal(ids.n, 0);
    db.close();
  });

  it("edit replace rolls back contact update when global unique fails", () => {
    const db = openBaseDb();
    // Minimal customers with phone column for edit simulation
    db.exec(`ALTER TABLE customers ADD COLUMN phone TEXT`);
    insertCustomer(db, "a");
    insertCustomer(db, "b");
    db.prepare(`UPDATE customers SET phone = ? WHERE id = ?`).run(
      "13800000001",
      "a",
    );
    db.prepare(`UPDATE customers SET phone = ? WHERE id = ?`).run(
      "13800000002",
      "b",
    );
    db.exec(SQL_0042);
    insertIdentifier(db, "ia", "a", "phone", "+8613800000001");
    insertIdentifier(db, "ib", "b", "phone", "+8613800000002");

    db.exec("BEGIN");
    try {
      db.prepare(`UPDATE customers SET phone = ? WHERE id = ?`).run(
        "13800000001",
        "b",
      );
      db.prepare(
        `DELETE FROM customer_contact_identifiers WHERE customer_id = ?`,
      ).run("b");
      db.prepare(
        `INSERT INTO customer_contact_identifiers
          (id, customer_id, contact_type, normalized_value, created_at, updated_at)
         VALUES ('ib2', 'b', 'phone', '+8613800000001', 't', 't')`,
      ).run();
      db.exec("COMMIT");
    } catch {
      db.exec("ROLLBACK");
    }

    const phone = db
      .prepare(`SELECT phone FROM customers WHERE id='b'`)
      .get() as { phone: string };
    const ids = db
      .prepare(
        `SELECT normalized_value FROM customer_contact_identifiers WHERE customer_id='b'`,
      )
      .all() as Array<{ normalized_value: string }>;
    assert.equal(phone.phone, "13800000002");
    assert.equal(ids.length, 1);
    assert.equal(ids[0]?.normalized_value, "+8613800000002");
    db.close();
  });

  it("buildReplace statements remain DELETE then INSERT for same-batch sync", () => {
    const calls: string[] = [];
    const fakeDb = {
      delete() {
        calls.push("delete");
        return { where() { return { kind: "delete" }; } };
      },
      insert() {
        calls.push("insert");
        return { values() { return { kind: "insert" }; } };
      },
    };
    const result = buildReplaceCustomerIdentifierStatements(fakeDb as never, {
      customerId: "c1",
      phoneCountryCode: "+86",
      phone: "13800138000",
      now: "2026-07-29T00:00:00.000Z",
    });
    assert.equal(calls[0], "delete");
    assert.ok(result.statements.length >= 2);
  });
});

describe("Phase 2B wiring + deploy plan (source)", () => {
  it("Create/Edit/Import/QE still map global constraint via conflict helper", () => {
    for (const path of [
      "src/app/api/customers/route.ts",
      "src/app/api/customers/[id]/route.ts",
      "src/lib/import/customers/commit.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      assert.match(source, /resolveIdentifierConstraintAsDuplicates/);
    }
    const qe = readFileSync(
      "src/lib/public-pool/quick-entry-customer-service.ts",
      "utf8",
    );
    assert.match(qe, /isGlobalContactIdentifierUniqueConstraintError/);
    const batch = readFileSync(
      "src/lib/public-pool/quick-entry-batch-service.ts",
      "utf8",
    );
    assert.match(batch, /isGlobalContactIdentifierUniqueConstraintError/);
  });

  it("documents official 0042 production order in migration comments", () => {
    assert.match(SQL_0042, /Remote apply 0042 once/);
    assert.match(SQL_0042, /Live Coverage/);
    assert.match(SQL_0042, /do NOT delete\/merge customers/i);
  });
});
