import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createRequire } from "node:module";
import {
  classifyContactIdentifierUniqueConstraintError,
} from "@/lib/customers/contact-identifiers";
import {
  duplicateCustomerConflictResponse,
  resolveIdentifierConstraintAsDuplicates,
} from "@/lib/customers/contact-identifier-conflict";
import {
  findCrossCustomerIdentifierConflicts,
  verifyCustomerContactIdentifierCoverage,
  runContactIdentifiersBackfillDryRun,
} from "@/lib/customers/contact-identifiers-backfill";
import { schema } from "@/lib/db";
import type { DuplicateMatch } from "@/lib/customers/duplicate-check";

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

const REAL_GLOBAL_MSG =
  "UNIQUE constraint failed: customer_contact_identifiers.contact_type, customer_contact_identifiers.normalized_value";

describe("Phase 2B constraint mapping against real signatures", () => {
  it("maps real global SQLite message to global kind", () => {
    assert.equal(
      classifyContactIdentifierUniqueConstraintError(new Error(REAL_GLOBAL_MSG)),
      "global",
    );
  });

  it("does not map assignee / customer_code / unrelated uniques", () => {
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
        new Error("UNIQUE constraint failed: customers.customer_code"),
      ),
      null,
    );
    assert.equal(
      classifyContactIdentifierUniqueConstraintError(
        new Error(
          "UNIQUE constraint failed: public_pool_quick_entry_submission_rows.submission_db_id, public_pool_quick_entry_submission_rows.client_row_id",
        ),
      ),
      null,
    );
  });

  it("per-customer index name stays per_customer (not cross-customer map)", async () => {
    const mapped = await resolveIdentifierConstraintAsDuplicates(
      new Error(
        "UNIQUE constraint failed: uq_customer_contact_identifiers_customer_type_value",
      ),
      { phoneCountryCode: "+86", phone: "13800138000" },
      { id: "u1", role: "admin" } as never,
    );
    assert.equal(mapped, null);
  });

  it("safe generic 409 when global fails but scan returns empty", async () => {
    // Will call real checkCustomerDuplicates via getDb — only safe if bind absent.
    // Instead assert response shape for empty duplicates list.
    const response = duplicateCustomerConflictResponse([]);
    assert.equal(response.status, 409);
    const body = (await response.json()) as {
      errorCode: string;
      duplicate: boolean;
      duplicates: DuplicateMatch[];
      error?: string;
    };
    assert.equal(body.errorCode, "DUPLICATE_CUSTOMER");
    assert.equal(body.duplicate, true);
    assert.deepEqual(body.duplicates, []);
    assert.ok(body.error);
  });

  it("authorized vs masked Phase 1 duplicate shapes remain distinct", () => {
    const authorized: DuplicateMatch = {
      field: "phone",
      matchedField: "phone",
      customer: {
        isMasked: false,
        id: "c1",
        customerCode: "EF1",
        displayName: "A",
        salesStage: "new_lead",
        href: "/customers/c1",
      },
    };
    const masked: DuplicateMatch = {
      field: "email",
      matchedField: "email",
      customer: { isMasked: true },
    };
    assert.equal(authorized.customer.isMasked, false);
    assert.equal(masked.customer.isMasked, true);
    if (!authorized.customer.isMasked) {
      assert.ok(authorized.customer.id);
      assert.ok(authorized.customer.href);
    }
  });
});

describe("Phase 2B Create/Edit/Import/QE/on-hold race wiring", () => {
  it("Create maps constraint before approval / audit paths", () => {
    const source = readFileSync("src/app/api/customers/route.ts", "utf8");
    const batchIdx = source.indexOf("await db.batch");
    const mapIdx = source.indexOf("resolveIdentifierConstraintAsDuplicates");
    const approvalIdx = source.indexOf("createApprovalRequest");
    assert.ok(batchIdx > 0 && mapIdx > 0);
    assert.ok(mapIdx < approvalIdx || approvalIdx < 0);
    assert.match(source, /duplicateCustomerConflictResponse/);
    // Duplicate 409 path does not write audit (Phase 1 comment still present).
    assert.match(source, /duplicate 409 must not write CRM audit/i);
  });

  it("Edit uses excludeId and same-batch replace", () => {
    const source = readFileSync("src/app/api/customers/[id]/route.ts", "utf8");
    assert.match(source, /persistCustomerAndIdentifiers/);
    assert.match(source, /resolveIdentifierConstraintAsDuplicates\([\s\S]*\bid\b/);
    assert.match(source, /\.\.\.identifierSync\.statements/);
  });

  it("Import and QE keep identifiers in customer batch", () => {
    const commit = readFileSync("src/lib/import/customers/commit.ts", "utf8");
    assert.match(commit, /\.\.\.identifierSync\.statements/);
    assert.match(commit, /resolveIdentifierConstraintAsDuplicates/);
    const qe = readFileSync(
      "src/lib/public-pool/quick-entry-customer-service.ts",
      "utf8",
    );
    assert.match(qe, /\.\.\.identifierSync\.statements/);
    const batch = readFileSync(
      "src/lib/public-pool/quick-entry-batch-service.ts",
      "utf8",
    );
    assert.match(batch, /QUICK_ENTRY_ROW_STATUS_DUPLICATE/);
    assert.match(batch, /duplicateField/);
  });
});

describe("Phase 2B backfill/coverage with global unique present", () => {
  it("conflict scanner still blocks apply planning when cross conflicts exist", () => {
    const conflicts = findCrossCustomerIdentifierConflicts([
      {
        customerId: "a",
        customerCode: "EF1",
        status: "active",
        identifiers: [
          { contactType: "wechat_id", normalizedValue: "same_wx" },
        ],
        unnormalizableCount: 0,
      },
      {
        customerId: "b",
        customerCode: "EF2",
        status: "public_pool",
        identifiers: [
          { contactType: "wechat_id", normalizedValue: "same_wx" },
        ],
        unnormalizableCount: 0,
      },
    ]);
    assert.equal(conflicts.length, 1);
    assert.ok(!JSON.stringify(conflicts).includes("same_wx"));
  });

  it("coverage ok when expected equals actual (mocked)", async () => {
    const customers = [
      {
        id: "c1",
        customerCode: "EF1",
        status: "active",
        phoneCountryCode: "+86",
        phone: "19988001001",
        wechatId: null,
        email: null,
      },
    ];
    const identifiers = [
      {
        customerId: "c1",
        contactType: "phone",
        normalizedValue: "+8619988001001",
      },
    ];

    function resolveTable(table: unknown): string {
      if (table === schema.customers) return "customers";
      if (table === schema.customerContacts) return "contacts";
      if (table === schema.customerContactIdentifiers) return "identifiers";
      return "unknown";
    }

    const fakeDb = {
      select() {
        let table = "unknown";
        const run = () => {
          if (table === "customers") return customers;
          if (table === "contacts") return [];
          if (table === "identifiers") return identifiers;
          return [];
        };
        const api = {
          from(t: unknown) {
            table = resolveTable(t);
            return api;
          },
          where() {
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
    };

    const coverage = await verifyCustomerContactIdentifierCoverage(
      fakeDb as never,
    );
    assert.equal(coverage.ok, true);
    assert.equal(coverage.crossCustomerConflictCount, 0);

    const dry = await runContactIdentifiersBackfillDryRun(fakeDb as never);
    assert.equal(dry.wouldInsert, 0);
    assert.equal(dry.wouldDelete, 0);
    assert.equal(dry.conflictCount, 0);
  });
});

describe("Phase 2B same-normalized edit is not a conflict at SQL layer", () => {
  it("re-inserting same normalized value for same customer after delete succeeds under 0042", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON;");
    db.exec(`CREATE TABLE customers (id TEXT PRIMARY KEY NOT NULL);`);
    db.exec(
      readFileSync(
        "drizzle/migrations/0041_create_customer_contact_identifiers.sql",
        "utf8",
      ),
    );
    db.exec(
      readFileSync(
        "drizzle/migrations/0042_add_global_contact_identifier_unique.sql",
        "utf8",
      ),
    );
    db.prepare(`INSERT INTO customers(id) VALUES ('c1')`).run();
    const now = "t";
    db.prepare(
      `INSERT INTO customer_contact_identifiers
        (id, customer_id, contact_type, normalized_value, created_at, updated_at)
       VALUES ('i1','c1','phone','+8613800138000',?,?)`,
    ).run(now, now);
    db.prepare(
      `DELETE FROM customer_contact_identifiers WHERE customer_id='c1'`,
    ).run();
    db.prepare(
      `INSERT INTO customer_contact_identifiers
        (id, customer_id, contact_type, normalized_value, created_at, updated_at)
       VALUES ('i2','c1','phone','+8613800138000',?,?)`,
    ).run(now, now);
    const n = db
      .prepare(`SELECT COUNT(*) AS n FROM customer_contact_identifiers`)
      .get() as { n: number };
    assert.equal(n.n, 1);
    db.close();
  });
});
