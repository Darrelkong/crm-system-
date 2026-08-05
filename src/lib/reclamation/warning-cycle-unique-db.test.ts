import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { isReclamationWarningLogUniqueConflictError } from "@/lib/reclamation/warning-log-unique";

const CUSTOMER_A = "77777777-7777-7777-7777-777777777701";
const CUSTOMER_B = "77777777-7777-7777-7777-777777777702";
const CYCLE_A = "2026-06-01T00:00:00.000Z";
const CYCLE_B = "2026-07-01T00:00:00.000Z";

type Db = ReturnType<typeof drizzle<typeof schema>>;

let db: Db;
let disposeProxy: (() => Promise<void>) | undefined;

async function deleteRows() {
  for (const customerId of [CUSTOMER_A, CUSTOMER_B]) {
    await db
      .delete(schema.reclamationWarningLogs)
      .where(eq(schema.reclamationWarningLogs.customerId, customerId));
    await db
      .delete(schema.customers)
      .where(eq(schema.customers.id, customerId));
  }
}

describe("migration 0044 warning unique index", () => {
  it("defines customer_id + cycle_started_at + warning_milestone uniqueness", () => {
    const sql = readFileSync(
      join(process.cwd(), "drizzle/migrations/0044_reclamation_cycle_and_warnings.sql"),
      "utf8",
    );
    assert.match(sql, /idx_reclamation_warning_cycle_milestone/);
    assert.match(sql, /customer_id,\s*cycle_started_at,\s*warning_milestone/);
    assert.match(sql, /Asia\/Hong_Kong/);
  });
});

describe("warning cycle milestone unique index DB", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
    await deleteRows();
  });

  after(async () => {
    await deleteRows();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("allows different customers to share the same milestone", async () => {
    await db.insert(schema.customers).values([
      {
        id: CUSTOMER_A,
        customerName: "Unique A",
        source: "referral",
        salesStage: "negotiation",
        ownerId: SEED_IDS.staffA,
        status: "active",
        createdBy: SEED_IDS.admin,
        createdAt: CYCLE_A,
        updatedAt: CYCLE_A,
      },
      {
        id: CUSTOMER_B,
        customerName: "Unique B",
        source: "referral",
        salesStage: "negotiation",
        ownerId: SEED_IDS.staffA,
        status: "active",
        createdBy: SEED_IDS.admin,
        createdAt: CYCLE_A,
        updatedAt: CYCLE_A,
      },
    ]);

    await db.insert(schema.reclamationWarningLogs).values([
      {
        id: crypto.randomUUID(),
        customerId: CUSTOMER_A,
        warningType: "day_6",
        warningDate: "2026-07-01",
        cycleStartedAt: CYCLE_A,
        warningMilestone: 7,
        reclaimDaysSnapshot: 14,
        ownerId: SEED_IDS.staffA,
        createdAt: CYCLE_A,
      },
      {
        id: crypto.randomUUID(),
        customerId: CUSTOMER_B,
        warningType: "day_6",
        warningDate: "2026-07-01",
        cycleStartedAt: CYCLE_A,
        warningMilestone: 7,
        reclaimDaysSnapshot: 14,
        ownerId: SEED_IDS.staffA,
        createdAt: CYCLE_A,
      },
    ]);

    const rows = await db
      .select()
      .from(schema.reclamationWarningLogs)
      .where(
        and(
          eq(schema.reclamationWarningLogs.warningMilestone, 7),
          eq(schema.reclamationWarningLogs.cycleStartedAt, CYCLE_A),
        ),
      );
    assert.equal(rows.length, 2);
  });

  it("allows same customer different cycles", async () => {
    await deleteRows();
    await db.insert(schema.customers).values({
      id: CUSTOMER_A,
      customerName: "Cycle A",
      source: "referral",
      salesStage: "negotiation",
      ownerId: SEED_IDS.staffA,
      status: "active",
      createdBy: SEED_IDS.admin,
      createdAt: CYCLE_A,
      updatedAt: CYCLE_A,
    });

    await db.insert(schema.reclamationWarningLogs).values([
      {
        id: crypto.randomUUID(),
        customerId: CUSTOMER_A,
        warningType: "day_6",
        warningDate: "2026-07-01",
        cycleStartedAt: CYCLE_A,
        warningMilestone: 7,
        reclaimDaysSnapshot: 14,
        ownerId: SEED_IDS.staffA,
        createdAt: CYCLE_A,
      },
      {
        id: crypto.randomUUID(),
        customerId: CUSTOMER_A,
        warningType: "day_6",
        warningDate: "2026-08-01",
        cycleStartedAt: CYCLE_B,
        warningMilestone: 7,
        reclaimDaysSnapshot: 14,
        ownerId: SEED_IDS.staffA,
        createdAt: CYCLE_B,
      },
    ]);

    const rows = await db
      .select()
      .from(schema.reclamationWarningLogs)
      .where(eq(schema.reclamationWarningLogs.customerId, CUSTOMER_A));
    assert.equal(rows.length, 2);
  });

  it("rejects duplicate customer + cycle + milestone", async () => {
    await deleteRows();
    await db.insert(schema.customers).values({
      id: CUSTOMER_A,
      customerName: "Dup",
      source: "referral",
      salesStage: "negotiation",
      ownerId: SEED_IDS.staffA,
      status: "active",
      createdBy: SEED_IDS.admin,
      createdAt: CYCLE_A,
      updatedAt: CYCLE_A,
    });

    const base = {
      customerId: CUSTOMER_A,
      warningType: "day_6" as const,
      warningDate: "2026-07-01",
      cycleStartedAt: CYCLE_A,
      warningMilestone: 7,
      reclaimDaysSnapshot: 14,
      ownerId: SEED_IDS.staffA,
      createdAt: CYCLE_A,
    };

    await db.insert(schema.reclamationWarningLogs).values({
      id: crypto.randomUUID(),
      ...base,
    });

    let duplicateError: unknown;
    try {
      await db.insert(schema.reclamationWarningLogs).values({
        id: crypto.randomUUID(),
        ...base,
        warningType: "day_7",
      });
    } catch (error) {
      duplicateError = error;
    }
    assert.ok(duplicateError != null);
    assert.equal(
      isReclamationWarningLogUniqueConflictError(duplicateError),
      true,
    );
  });
});
