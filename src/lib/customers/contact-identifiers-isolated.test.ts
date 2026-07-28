import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildCustomerContactIdentifiers,
  buildReplaceCustomerIdentifierStatements,
} from "@/lib/customers/contact-identifiers";
import {
  ContactIdentifiersBackfillError,
  diffIdentifierSets,
  findCrossCustomerIdentifierConflicts,
  maskNormalizedIdentifier,
  runContactIdentifiersBackfillApply,
  runContactIdentifiersBackfillDryRun,
  verifyCustomerContactIdentifierCoverage,
} from "@/lib/customers/contact-identifiers-backfill";
import { schema } from "@/lib/db";

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

function openIsolatedDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE customers (
      id TEXT PRIMARY KEY NOT NULL,
      customer_code TEXT,
      customer_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      phone_country_code TEXT NOT NULL DEFAULT '+86',
      phone TEXT,
      wechat_id TEXT,
      email TEXT
    );
    CREATE TABLE customer_contacts (
      id TEXT PRIMARY KEY NOT NULL,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      phone TEXT,
      wechat_id TEXT,
      email TEXT
    );
  `);
  db.exec(
    readFileSync(
      "drizzle/migrations/0041_create_customer_contact_identifiers.sql",
      "utf8",
    ),
  );
  return db;
}

type CustomerRow = {
  id: string;
  customerCode: string | null;
  status: string;
  phoneCountryCode: string | null;
  phone: string | null;
  wechatId: string | null;
  email: string | null;
};

function makeBackfillFakeDb(input: {
  customers: CustomerRow[];
  contacts?: Array<{
    customerId: string;
    phone: string | null;
    wechatId: string | null;
    email: string | null;
  }>;
  identifiers?: Array<{
    customerId: string;
    contactType: string;
    normalizedValue: string;
  }>;
  onBatch?: () => void;
}) {
  const contacts = input.contacts ?? [];
  const identifiers = input.identifiers ?? [];

  function resolveTable(table: unknown): string {
    if (table === schema.customers) return "customers";
    if (table === schema.customerContacts) return "contacts";
    if (table === schema.customerContactIdentifiers) return "identifiers";
    return "unknown";
  }

  return {
    select() {
      let table = "unknown";
      let whereCustomerId: string | null = null;
      const run = () => {
        if (table === "customers") return input.customers;
        if (table === "contacts") {
          if (whereCustomerId) {
            return contacts.filter((c) => c.customerId === whereCustomerId);
          }
          return contacts;
        }
        if (table === "identifiers") {
          if (whereCustomerId) {
            return identifiers.filter((r) => r.customerId === whereCustomerId);
          }
          return identifiers;
        }
        return [];
      };
      const api = {
        from(t: unknown) {
          table = resolveTable(t);
          return api;
        },
        where(condition: unknown) {
          // drizzle eq() opaque — loadPlans uses eq(customerId) only in apply path.
          // For apply path we re-query; treat any where as filtering first customer when needed.
          const maybe = condition as { queryChunks?: unknown };
          void maybe;
          // Heuristic: apply loop queries by plan.customerId via eq — we cannot read eq args.
          // Provide full lists; apply's per-customer where will get empty unless we ignore where.
          // Override: when where is used, return all matching by scanning (tests use 0-2 rows).
          whereCustomerId = null;
          return {
            then(onFulfilled: (rows: unknown[]) => unknown) {
              return Promise.resolve(onFulfilled(run()));
            },
          };
        },
        then(onFulfilled: (rows: unknown[]) => unknown) {
          return Promise.resolve(onFulfilled(run()));
        },
      };
      return api;
    },
    async batch() {
      input.onBatch?.();
    },
    delete() {
      return {
        where() {
          return { kind: "delete" };
        },
      };
    },
    insert() {
      return {
        values() {
          return { kind: "insert" };
        },
      };
    },
  };
}

describe("Phase 2A identifiers atomicity (isolated sqlite)", () => {
  it("create customer+identifiers batch rolls back on later statement failure", () => {
    const db = openIsolatedDb();
    const now = "2026-07-29T03:00:00.000Z";
    db.exec("BEGIN");
    db.prepare(
      `INSERT INTO customers (id, customer_code, customer_name, status, phone_country_code, phone)
       VALUES (?, ?, ?, 'active', '+86', ?)`,
    ).run("c1", "EF1", "A", "19988001001");
    const ids = buildCustomerContactIdentifiers({
      phoneCountryCode: "+86",
      phone: "19988001001",
    });
    for (const row of ids) {
      db.prepare(
        `INSERT INTO customer_contact_identifiers
          (id, customer_id, contact_type, normalized_value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        "c1",
        row.contactType,
        row.normalizedValue,
        now,
        now,
      );
    }
    assert.throws(() => {
      db.prepare(
        `INSERT INTO customers (id, customer_code, customer_name, status)
         VALUES (?, ?, ?, 'active')`,
      ).run("c1", "EFX", "dup");
    });
    db.exec("ROLLBACK");

    const customers = db.prepare(`SELECT COUNT(*) AS n FROM customers`).get() as {
      n: number;
    };
    const identifiers = db
      .prepare(`SELECT COUNT(*) AS n FROM customer_contact_identifiers`)
      .get() as { n: number };
    assert.equal(customers.n, 0);
    assert.equal(identifiers.n, 0);
    db.close();
  });

  it("edit update+replace identifiers rolls back together", () => {
    const db = openIsolatedDb();
    const now = "2026-07-29T03:00:00.000Z";
    db.prepare(
      `INSERT INTO customers (id, customer_code, customer_name, status, phone_country_code, phone)
       VALUES (?, ?, ?, 'active', '+86', ?)`,
    ).run("c1", "EF1", "A", "19988001001");
    db.prepare(
      `INSERT INTO customer_contact_identifiers
        (id, customer_id, contact_type, normalized_value, created_at, updated_at)
       VALUES (?, 'c1', 'phone', ?, ?, ?)`,
    ).run("i1", "+8619988001001", now, now);

    db.exec("BEGIN");
    try {
      db.prepare(`UPDATE customers SET phone = ? WHERE id = ?`).run(
        "19988001999",
        "c1",
      );
      db.prepare(
        `DELETE FROM customer_contact_identifiers WHERE customer_id = ?`,
      ).run("c1");
      db.prepare(
        `INSERT INTO customer_contact_identifiers
          (id, customer_id, contact_type, normalized_value, created_at, updated_at)
         VALUES (?, 'c1', 'phone', ?, ?, ?)`,
      ).run("i2", "+8619988001999", now, now);
      db.prepare(
        `INSERT INTO customer_contact_identifiers
          (id, customer_id, contact_type, normalized_value, created_at, updated_at)
         VALUES (?, 'c1', 'phone', ?, ?, ?)`,
      ).run("i3", "+8619988001999", now, now);
      db.exec("COMMIT");
    } catch {
      db.exec("ROLLBACK");
    }

    const customer = db
      .prepare(`SELECT phone FROM customers WHERE id = 'c1'`)
      .get() as { phone: string };
    const ids = db
      .prepare(
        `SELECT normalized_value FROM customer_contact_identifiers WHERE customer_id = 'c1'`,
      )
      .all() as Array<{ normalized_value: string }>;
    assert.equal(customer.phone, "19988001001");
    assert.equal(ids.length, 1);
    assert.equal(ids[0]?.normalized_value, "+8619988001001");
    db.close();
  });

  it("permanent delete cascades identifiers; archived keeps them until delete", () => {
    const db = openIsolatedDb();
    const now = "2026-07-29T03:00:00.000Z";
    db.prepare(
      `INSERT INTO customers (id, customer_code, customer_name, status, phone_country_code, phone)
       VALUES (?, ?, ?, 'archived', '+86', ?)`,
    ).run("c1", "EF1", "A", "19988002002");
    db.prepare(
      `INSERT INTO customer_contact_identifiers
        (id, customer_id, contact_type, normalized_value, created_at, updated_at)
       VALUES (?, 'c1', 'phone', ?, ?, ?)`,
    ).run("i1", "+8619988002002", now, now);

    let n = db
      .prepare(`SELECT COUNT(*) AS n FROM customer_contact_identifiers`)
      .get() as { n: number };
    assert.equal(n.n, 1);

    db.prepare(`DELETE FROM customers WHERE id = 'c1'`).run();
    n = db
      .prepare(`SELECT COUNT(*) AS n FROM customer_contact_identifiers`)
      .get() as { n: number };
    assert.equal(n.n, 0);
    db.close();
  });

  it("buildReplaceCustomerIdentifierStatements shape is DELETE then inserts", () => {
    const calls: string[] = [];
    const fakeDb = {
      delete() {
        calls.push("delete");
        return {
          where() {
            return { kind: "delete" };
          },
        };
      },
      insert() {
        calls.push("insert");
        return {
          values() {
            return { kind: "insert" };
          },
        };
      },
    };
    const result = buildReplaceCustomerIdentifierStatements(fakeDb as never, {
      customerId: "c1",
      phoneCountryCode: "+86",
      phone: "13800138000",
      wechatId: "wx",
      email: "a@b.c",
      now: "2026-07-29T00:00:00.000Z",
    });
    assert.equal(calls[0], "delete");
    assert.equal(result.statements.length, 4);
  });
});

describe("Phase 2A backfill conflict / apply gate", () => {
  it("conflict scan reports masked values", () => {
    const conflicts = findCrossCustomerIdentifierConflicts([
      {
        customerId: "a",
        customerCode: "EF1",
        status: "active",
        identifiers: [
          { contactType: "email", normalizedValue: "dup@example.com" },
        ],
        unnormalizableCount: 0,
      },
      {
        customerId: "b",
        customerCode: "EF2",
        status: "public_pool",
        identifiers: [
          { contactType: "email", normalizedValue: "dup@example.com" },
        ],
        unnormalizableCount: 0,
      },
    ]);
    assert.equal(conflicts.length, 1);
    assert.ok(!JSON.stringify(conflicts).includes("dup@example.com"));
    assert.ok(conflicts[0]?.maskedValue.includes("***"));
  });

  it("partial existing identifiers can be completed via diff", () => {
    const diff = diffIdentifierSets(
      [{ contactType: "phone", normalizedValue: "+86111" }],
      [
        { contactType: "phone", normalizedValue: "+86111" },
        { contactType: "wechat_id", normalizedValue: "wx" },
      ],
    );
    assert.deepEqual(diff, { insert: 1, delete: 0, keep: 1 });
  });

  it("mask helpers never emit full PII", () => {
    assert.ok(
      !maskNormalizedIdentifier("wechat_id", "secret_wechat").includes(
        "secret_wechat",
      ),
    );
  });

  it("dry-run reports 0 writes", async () => {
    const fakeDb = makeBackfillFakeDb({
      customers: [
        {
          id: "c1",
          customerCode: "EF1",
          status: "active",
          phoneCountryCode: "+86",
          phone: "19988001001",
          wechatId: null,
          email: null,
        },
        {
          id: "c2",
          customerCode: "EF2",
          status: "archived",
          phoneCountryCode: "+86",
          phone: "19988001002",
          wechatId: "WxTwo",
          email: "two@example.com",
        },
      ],
      onBatch: () => {
        throw new Error("dry-run must not batch");
      },
    });

    const result = await runContactIdentifiersBackfillDryRun(fakeDb as never);
    assert.equal(result.mode, "dry-run");
    assert.equal(result.rowsWritten, 0);
    assert.equal(result.customersScanned, 2);
    assert.equal(result.identifierCount, 4);
    assert.equal(result.existingIdentifierCount, 0);
    assert.equal(result.conflictCount, 0);
    assert.equal(result.safeToApply, true);
    assert.ok(result.wouldInsert >= 1);
  });

  it("coverage reports missing / extra / ownership without PII", async () => {
    const fakeDb = makeBackfillFakeDb({
      customers: [
        {
          id: "c1",
          customerCode: "EF1",
          status: "active",
          phoneCountryCode: "+86",
          phone: "19988001001",
          wechatId: null,
          email: null,
        },
      ],
      identifiers: [
        {
          customerId: "c1",
          contactType: "email",
          normalizedValue: "extra@example.com",
        },
        {
          customerId: "orphan",
          contactType: "phone",
          normalizedValue: "+8619900000000",
        },
      ],
    });

    const coverage = await verifyCustomerContactIdentifierCoverage(
      fakeDb as never,
    );
    assert.equal(coverage.missingCount >= 1, true);
    assert.equal(coverage.extraCount >= 1, true);
    assert.equal(coverage.ownershipMismatchCount >= 1, true);
    assert.equal(coverage.ok, false);
    assert.ok(
      !JSON.stringify(coverage.anomalies).includes("extra@example.com"),
    );
    assert.ok(!JSON.stringify(coverage.anomalies).includes("19900000000"));
  });

  it("coverage ok when expected matches actual", async () => {
    const fakeDb = makeBackfillFakeDb({
      customers: [
        {
          id: "c1",
          customerCode: "EF1",
          status: "active",
          phoneCountryCode: "+86",
          phone: "19988001001",
          wechatId: null,
          email: null,
        },
      ],
      identifiers: [
        {
          customerId: "c1",
          contactType: "phone",
          normalizedValue: "+8619988001001",
        },
      ],
    });
    const coverage = await verifyCustomerContactIdentifierCoverage(
      fakeDb as never,
    );
    assert.equal(coverage.ok, true);
    assert.equal(coverage.missingCount, 0);
    assert.equal(coverage.extraCount, 0);
    assert.equal(coverage.ownershipMismatchCount, 0);
    assert.equal(coverage.crossCustomerConflictCount, 0);
  });

  it("apply refuses when conflicts exist (0 writes)", async () => {
    let batches = 0;
    const fakeDb = makeBackfillFakeDb({
      customers: [
        {
          id: "c1",
          customerCode: "EF1",
          status: "active",
          phoneCountryCode: "+86",
          phone: "19988001001",
          wechatId: null,
          email: null,
        },
        {
          id: "c2",
          customerCode: "EF2",
          status: "public_pool",
          phoneCountryCode: "+86",
          phone: "19988001001",
          wechatId: null,
          email: null,
        },
      ],
      onBatch: () => {
        batches += 1;
      },
    });

    await assert.rejects(
      () => runContactIdentifiersBackfillApply(fakeDb as never),
      (err: unknown) =>
        err instanceof ContactIdentifiersBackfillError &&
        err.code === "CROSS_CUSTOMER_CONFLICTS",
    );
    assert.equal(batches, 0);
  });

  it("apply with 0 conflicts runs replace, coverage ok, re-run dry-run is 0 diff", async () => {
    let batches = 0;
    const customers: CustomerRow[] = [
      {
        id: "c1",
        customerCode: "EF1",
        status: "active",
        phoneCountryCode: "+86",
        phone: "19988001001",
        wechatId: null,
        email: "one@example.com",
      },
    ];
    const identifiers: Array<{
      customerId: string;
      contactType: string;
      normalizedValue: string;
    }> = [];

    const fakeDb = makeBackfillFakeDb({
      customers,
      identifiers,
      onBatch: () => {
        batches += 1;
        identifiers.length = 0;
        identifiers.push(
          {
            customerId: "c1",
            contactType: "phone",
            normalizedValue: "+8619988001001",
          },
          {
            customerId: "c1",
            contactType: "email",
            normalizedValue: "one@example.com",
          },
        );
      },
    });

    const first = await runContactIdentifiersBackfillApply(fakeDb as never, {
      now: "2026-07-29T03:00:00.000Z",
    });
    assert.equal(first.mode, "apply");
    assert.equal(first.conflictCount, 0);
    assert.equal(first.coverage.ok, true);
    assert.equal(batches, 1);

    const postDry = await runContactIdentifiersBackfillDryRun(fakeDb as never);
    assert.equal(postDry.wouldInsert, 0);
    assert.equal(postDry.wouldDelete, 0);

    const second = await runContactIdentifiersBackfillApply(fakeDb as never, {
      now: "2026-07-29T03:00:00.000Z",
    });
    assert.equal(second.mode, "apply");
    assert.equal(batches, 2);
  });
});
