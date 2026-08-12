import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { getCustomerIdsWithHouseholdIcon } from "./list-indicator";

const NOW = "2026-08-12T08:00:00.000Z";

const CUSTOMERS = {
  pairA: "b2-cust-pair-a",
  pairB: "b2-cust-pair-b",
  singleton: "b2-cust-singleton",
  histA: "b2-cust-hist-a",
  histB: "b2-cust-hist-b",
  softA: "b2-cust-soft-a",
  softB: "b2-cust-soft-b",
  archA: "b2-cust-arch-a",
  archB: "b2-cust-arch-b",
  dissA: "b2-cust-diss-a",
  dissB: "b2-cust-diss-b",
} as const;

const HOUSEHOLDS = {
  pair: "b2-hh-pair",
  singleton: "b2-hh-singleton",
  historical: "b2-hh-historical",
  softDelete: "b2-hh-soft-delete",
  archived: "b2-hh-archived",
  dissolved: "b2-hh-dissolved",
} as const;

const ALL_CUSTOMER_IDS = Object.values(CUSTOMERS);
const ALL_HOUSEHOLD_IDS = Object.values(HOUSEHOLDS);

function makeCustomerRow(
  id: string,
  overrides: Partial<typeof schema.customers.$inferInsert> = {},
) {
  return {
    id,
    customerName: `Household test ${id}`,
    source: "referral",
    createdBy: SEED_IDS.admin,
    updatedBy: SEED_IDS.admin,
    createdAt: NOW,
    updatedAt: NOW,
    ownerId: SEED_IDS.staffA,
    ...overrides,
  };
}

function makeHouseholdRow(
  id: string,
  overrides: Partial<typeof schema.customerHouseholds.$inferInsert> = {},
) {
  return {
    id,
    status: "active" as const,
    createdBy: SEED_IDS.admin,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeMemberRow(
  id: string,
  householdId: string,
  customerId: string,
  overrides: Partial<typeof schema.customerHouseholdMembers.$inferInsert> = {},
) {
  return {
    id,
    householdId,
    customerId,
    joinedAt: NOW,
    joinedBy: SEED_IDS.admin,
    ...overrides,
  };
}

describe("getCustomerIdsWithHouseholdIcon", () => {
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

    await db
      .delete(schema.customerHouseholdMembers)
      .where(
        inArray(schema.customerHouseholdMembers.householdId, ALL_HOUSEHOLD_IDS),
      );
    await db
      .delete(schema.customerHouseholds)
      .where(inArray(schema.customerHouseholds.id, ALL_HOUSEHOLD_IDS));
    await db
      .delete(schema.customers)
      .where(inArray(schema.customers.id, ALL_CUSTOMER_IDS));

    await db.insert(schema.customers).values([
      makeCustomerRow(CUSTOMERS.pairA),
      makeCustomerRow(CUSTOMERS.pairB),
      makeCustomerRow(CUSTOMERS.singleton),
    ]);
    await db.insert(schema.customers).values([
      makeCustomerRow(CUSTOMERS.histA),
      makeCustomerRow(CUSTOMERS.histB),
      makeCustomerRow(CUSTOMERS.softA),
    ]);
    await db.insert(schema.customers).values([
      makeCustomerRow(CUSTOMERS.softB, { deletedAt: NOW }),
      makeCustomerRow(CUSTOMERS.archA),
      makeCustomerRow(CUSTOMERS.archB, { status: "archived" }),
    ]);
    await db.insert(schema.customers).values([
      makeCustomerRow(CUSTOMERS.dissA),
      makeCustomerRow(CUSTOMERS.dissB),
    ]);

    await db.insert(schema.customerHouseholds).values([
      makeHouseholdRow(HOUSEHOLDS.pair),
      makeHouseholdRow(HOUSEHOLDS.singleton),
      makeHouseholdRow(HOUSEHOLDS.historical),
      makeHouseholdRow(HOUSEHOLDS.softDelete),
      makeHouseholdRow(HOUSEHOLDS.archived),
      makeHouseholdRow(HOUSEHOLDS.dissolved, { status: "dissolved" }),
    ]);

    await db.insert(schema.customerHouseholdMembers).values([
      makeMemberRow("b2-mem-pair-a", HOUSEHOLDS.pair, CUSTOMERS.pairA),
      makeMemberRow("b2-mem-pair-b", HOUSEHOLDS.pair, CUSTOMERS.pairB),
      makeMemberRow(
        "b2-mem-singleton-a",
        HOUSEHOLDS.singleton,
        CUSTOMERS.singleton,
      ),
      makeMemberRow("b2-mem-hist-a", HOUSEHOLDS.historical, CUSTOMERS.histA),
      makeMemberRow("b2-mem-hist-b", HOUSEHOLDS.historical, CUSTOMERS.histB, {
        leftAt: NOW,
      }),
      makeMemberRow(
        "b2-mem-soft-a",
        HOUSEHOLDS.softDelete,
        CUSTOMERS.softA,
      ),
      makeMemberRow(
        "b2-mem-soft-b",
        HOUSEHOLDS.softDelete,
        CUSTOMERS.softB,
      ),
      makeMemberRow("b2-mem-arch-a", HOUSEHOLDS.archived, CUSTOMERS.archA),
      makeMemberRow("b2-mem-arch-b", HOUSEHOLDS.archived, CUSTOMERS.archB),
      makeMemberRow("b2-mem-diss-a", HOUSEHOLDS.dissolved, CUSTOMERS.dissA),
      makeMemberRow("b2-mem-diss-b", HOUSEHOLDS.dissolved, CUSTOMERS.dissB),
    ]);
  });

  after(async () => {
    await db
      .delete(schema.customerHouseholdMembers)
      .where(
        inArray(schema.customerHouseholdMembers.householdId, ALL_HOUSEHOLD_IDS),
      );
    await db
      .delete(schema.customerHouseholds)
      .where(inArray(schema.customerHouseholds.id, ALL_HOUSEHOLD_IDS));
    await db
      .delete(schema.customers)
      .where(inArray(schema.customers.id, ALL_CUSTOMER_IDS));
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("case A: two active members both qualify", async () => {
    const result = await getCustomerIdsWithHouseholdIcon(db, [
      CUSTOMERS.pairA,
      CUSTOMERS.pairB,
    ]);
    assert.equal(result.has(CUSTOMERS.pairA), true);
    assert.equal(result.has(CUSTOMERS.pairB), true);
  });

  it("case B: singleton household does not qualify", async () => {
    const result = await getCustomerIdsWithHouseholdIcon(db, [
      CUSTOMERS.singleton,
    ]);
    assert.equal(result.has(CUSTOMERS.singleton), false);
  });

  it("case C: historical second member disqualifies active member", async () => {
    const result = await getCustomerIdsWithHouseholdIcon(db, [
      CUSTOMERS.histA,
      CUSTOMERS.histB,
    ]);
    assert.equal(result.has(CUSTOMERS.histA), false);
    assert.equal(result.has(CUSTOMERS.histB), false);
  });

  it("case D: soft-deleted second customer disqualifies visible member", async () => {
    const result = await getCustomerIdsWithHouseholdIcon(db, [
      CUSTOMERS.softA,
    ]);
    assert.equal(result.has(CUSTOMERS.softA), false);
  });

  it("case E: archived second customer still qualifies", async () => {
    const result = await getCustomerIdsWithHouseholdIcon(db, [
      CUSTOMERS.archA,
      CUSTOMERS.archB,
    ]);
    assert.equal(result.has(CUSTOMERS.archA), true);
    assert.equal(result.has(CUSTOMERS.archB), true);
  });

  it("case F: dissolved household does not qualify", async () => {
    const result = await getCustomerIdsWithHouseholdIcon(db, [
      CUSTOMERS.dissA,
      CUSTOMERS.dissB,
    ]);
    assert.equal(result.has(CUSTOMERS.dissA), false);
    assert.equal(result.has(CUSTOMERS.dissB), false);
  });

  it("case G: scoped result returns only requested customer IDs", async () => {
    const result = await getCustomerIdsWithHouseholdIcon(db, [CUSTOMERS.pairA]);
    assert.equal(result.has(CUSTOMERS.pairA), true);
    assert.equal(result.has(CUSTOMERS.pairB), false);
    assert.equal(result.size, 1);
  });

  it("case H: empty input returns empty set without D1 query", async () => {
    const result = await getCustomerIdsWithHouseholdIcon(db, []);
    assert.equal(result.size, 0);
  });

  it("uses one bounded db.select operation", () => {
    const source = readFileSync(
      "src/lib/customers/households/list-indicator.ts",
      "utf8",
    );
    assert.match(source, /if \(customerIds\.length === 0\)/);
    assert.match(source, /db\s*\n?\s*\.select\(/);
    assert.doesNotMatch(source, /customer_household_relationships/);
    assert.match(source, /EXISTS/);
    assert.doesNotMatch(source, /for\s*\(|\.map\(async/);
  });
});
