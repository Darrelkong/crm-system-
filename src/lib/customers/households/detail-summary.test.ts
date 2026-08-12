import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { HouseholdRelationshipType } from "../../../../drizzle/schema/household-relationship-types";
import {
  getCustomerHouseholdDetailSummary,
  resolveRelationshipFromCurrentPerspective,
} from "./detail-summary";
import type { User } from "../../../../drizzle/schema/users";

const NOW = "2026-08-12T09:00:00.000Z";
const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;

const C = {
  adminA: "b3-cust-admin-a",
  adminB: "b3-cust-admin-b",
  deniedA: "b3-cust-denied-a",
  deniedB: "b3-cust-denied-b",
  assigneeA: "b3-cust-assignee-a",
  assigneeB: "b3-cust-assignee-b",
  poolA: "b3-cust-pool-a",
  poolB: "b3-cust-pool-b",
  archA: "b3-cust-arch-a",
  archB: "b3-cust-arch-b",
  softA: "b3-cust-soft-a",
  softB: "b3-cust-soft-b",
  histA: "b3-cust-hist-a",
  histB: "b3-cust-hist-b",
  inverseA: "b3-cust-inverse-a",
  inverseB: "b3-cust-inverse-b",
  missingA: "b3-cust-missing-a",
  missingB: "b3-cust-missing-b",
  malformedA: "b3-cust-malformed-a",
  malformedB: "b3-cust-malformed-b",
  singleton: "b3-cust-singleton",
  dissolvedA: "b3-cust-diss-a",
  dissolvedB: "b3-cust-diss-b",
} as const;

const H = {
  adminPair: "b3-hh-admin",
  deniedPair: "b3-hh-denied",
  assigneePair: "b3-hh-assignee",
  poolPair: "b3-hh-pool",
  archPair: "b3-hh-arch",
  softPair: "b3-hh-soft",
  histPair: "b3-hh-hist",
  inversePair: "b3-hh-inverse",
  missingPair: "b3-hh-missing",
  malformedPair: "b3-hh-malformed",
  singleton: "b3-hh-singleton",
  dissolved: "b3-hh-dissolved",
} as const;

const ALL_CUSTOMERS = Object.values(C);
const ALL_HOUSEHOLDS = Object.values(H);
const ALL_MEMBER_IDS = [
  "b3-mem-admin-a",
  "b3-mem-admin-b",
  "b3-mem-denied-a",
  "b3-mem-denied-b",
  "b3-mem-assignee-a",
  "b3-mem-assignee-b",
  "b3-mem-pool-a",
  "b3-mem-pool-b",
  "b3-mem-arch-a",
  "b3-mem-arch-b",
  "b3-mem-soft-a",
  "b3-mem-soft-b",
  "b3-mem-hist-a",
  "b3-mem-hist-b",
  "b3-mem-inverse-a",
  "b3-mem-inverse-b",
  "b3-mem-missing-a",
  "b3-mem-missing-b",
  "b3-mem-malformed-a",
  "b3-mem-malformed-b",
  "b3-mem-singleton-a",
  "b3-mem-diss-a",
  "b3-mem-diss-b",
] as const;

function customer(
  id: string,
  overrides: Partial<typeof schema.customers.$inferInsert> = {},
) {
  return {
    id,
    customerName: `B3 ${id}`,
    source: "referral",
    createdBy: SEED_IDS.admin,
    updatedBy: SEED_IDS.admin,
    createdAt: NOW,
    updatedAt: NOW,
    ownerId: SEED_IDS.staffA,
    ...overrides,
  };
}

function household(
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

function member(
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

function relationship(
  id: string,
  householdId: string,
  fromCustomerId: string,
  toCustomerId: string,
  relationshipType: HouseholdRelationshipType,
) {
  return {
    id,
    householdId,
    fromCustomerId,
    toCustomerId,
    relationshipType,
    createdBy: SEED_IDS.admin,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("getCustomerHouseholdDetailSummary", () => {
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
      .delete(schema.customerHouseholdRelationships)
      .where(
        inArray(schema.customerHouseholdRelationships.householdId, ALL_HOUSEHOLDS),
      );
    await db
      .delete(schema.customerHouseholdMembers)
      .where(inArray(schema.customerHouseholdMembers.id, [...ALL_MEMBER_IDS]));
    await db
      .delete(schema.customerHouseholds)
      .where(inArray(schema.customerHouseholds.id, ALL_HOUSEHOLDS));
    await db
      .delete(schema.customerAssignees)
      .where(inArray(schema.customerAssignees.customerId, ALL_CUSTOMERS));
    await db
      .delete(schema.customers)
      .where(inArray(schema.customers.id, ALL_CUSTOMERS));

    await db.insert(schema.customers).values([
      customer(C.adminA),
      customer(C.adminB),
      customer(C.deniedA, { ownerId: SEED_IDS.staffA }),
      customer(C.deniedB, { ownerId: SEED_IDS.staffB }),
      customer(C.assigneeA, { ownerId: SEED_IDS.staffA }),
      customer(C.assigneeB, { ownerId: SEED_IDS.staffB }),
    ]);
    await db.insert(schema.customers).values([
      customer(C.poolA, { ownerId: SEED_IDS.staffA }),
      customer(C.poolB, { ownerId: null, status: "public_pool" }),
      customer(C.archA, { ownerId: SEED_IDS.staffA }),
      customer(C.archB, { ownerId: SEED_IDS.staffA, status: "archived" }),
      customer(C.softA, { ownerId: SEED_IDS.staffA }),
      customer(C.softB, { ownerId: SEED_IDS.staffA, deletedAt: NOW }),
    ]);
    await db.insert(schema.customers).values([
      customer(C.histA, { ownerId: SEED_IDS.staffA }),
      customer(C.histB, { ownerId: SEED_IDS.staffB }),
      customer(C.inverseA),
      customer(C.inverseB),
      customer(C.missingA),
      customer(C.missingB),
    ]);
    await db.insert(schema.customers).values([
      customer(C.malformedA),
      customer(C.malformedB),
      customer(C.singleton),
      customer(C.dissolvedA),
      customer(C.dissolvedB),
    ]);

    await db.insert(schema.customerHouseholds).values([
      household(H.adminPair),
      household(H.deniedPair),
      household(H.assigneePair),
      household(H.poolPair),
      household(H.archPair),
      household(H.softPair),
      household(H.histPair),
      household(H.inversePair),
      household(H.missingPair),
      household(H.malformedPair),
      household(H.singleton),
      household(H.dissolved, { status: "dissolved" }),
    ]);

    await db.insert(schema.customerHouseholdMembers).values([
      member("b3-mem-admin-a", H.adminPair, C.adminA),
      member("b3-mem-admin-b", H.adminPair, C.adminB),
      member("b3-mem-denied-a", H.deniedPair, C.deniedA),
      member("b3-mem-denied-b", H.deniedPair, C.deniedB),
      member("b3-mem-assignee-a", H.assigneePair, C.assigneeA),
      member("b3-mem-assignee-b", H.assigneePair, C.assigneeB),
      member("b3-mem-pool-a", H.poolPair, C.poolA),
      member("b3-mem-pool-b", H.poolPair, C.poolB),
    ]);
    await db.insert(schema.customerHouseholdMembers).values([
      member("b3-mem-arch-a", H.archPair, C.archA),
      member("b3-mem-arch-b", H.archPair, C.archB),
      member("b3-mem-soft-a", H.softPair, C.softA),
      member("b3-mem-soft-b", H.softPair, C.softB),
      member("b3-mem-hist-a", H.histPair, C.histA),
      member("b3-mem-hist-b", H.histPair, C.histB, { leftAt: NOW }),
      member("b3-mem-inverse-a", H.inversePair, C.inverseA),
      member("b3-mem-inverse-b", H.inversePair, C.inverseB),
    ]);
    await db.insert(schema.customerHouseholdMembers).values([
      member("b3-mem-missing-a", H.missingPair, C.missingA),
      member("b3-mem-missing-b", H.missingPair, C.missingB),
      member("b3-mem-malformed-a", H.malformedPair, C.malformedA),
      member("b3-mem-malformed-b", H.malformedPair, C.malformedB),
      member("b3-mem-singleton-a", H.singleton, C.singleton),
      member("b3-mem-diss-a", H.dissolved, C.dissolvedA),
      member("b3-mem-diss-b", H.dissolved, C.dissolvedB),
    ]);

    await db.insert(schema.customerHouseholdRelationships).values([
      relationship("b3-rel-admin", H.adminPair, C.adminA, C.adminB, "father"),
      relationship(
        "b3-rel-inverse",
        H.inversePair,
        C.inverseB,
        C.inverseA,
        "son",
      ),
      relationship(
        "b3-rel-malformed-direct",
        H.malformedPair,
        C.malformedA,
        C.malformedB,
        "father",
      ),
      relationship(
        "b3-rel-malformed-reverse",
        H.malformedPair,
        C.malformedB,
        C.malformedA,
        "son",
      ),
    ]);

    await db.insert(schema.customerAssignees).values({
      id: "b3-assignee-staff-a-b",
      customerId: C.assigneeB,
      userId: SEED_IDS.staffA,
      role: "collaborator",
      assignedBy: SEED_IDS.admin,
      assignedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  after(async () => {
    await db
      .delete(schema.customerHouseholdRelationships)
      .where(
        inArray(schema.customerHouseholdRelationships.householdId, ALL_HOUSEHOLDS),
      );
    await db
      .delete(schema.customerHouseholdMembers)
      .where(inArray(schema.customerHouseholdMembers.id, [...ALL_MEMBER_IDS]));
    await db
      .delete(schema.customerHouseholds)
      .where(inArray(schema.customerHouseholds.id, ALL_HOUSEHOLDS));
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.id, "b3-assignee-staff-a-b"));
    await db
      .delete(schema.customers)
      .where(inArray(schema.customers.id, ALL_CUSTOMERS));
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("admin sees authorized member with direct relationship", async () => {
    const summary = await getCustomerHouseholdDetailSummary(db, admin, {
      id: C.adminA,
    });
    assert.ok(summary);
    assert.equal(summary.hasProtectedMembers, false);
    assert.equal(summary.members.length, 1);
    assert.equal(summary.members[0]?.customerId, C.adminB);
    assert.equal(summary.members[0]?.relationshipType, "father");
  });

  it("staff without access to B gets protected summary only", async () => {
    const summary = await getCustomerHouseholdDetailSummary(db, staffA, {
      id: C.deniedA,
    });
    assert.ok(summary);
    assert.equal(summary.members.length, 0);
    assert.equal(summary.hasProtectedMembers, true);
    const serialized = JSON.stringify(summary);
    assert.doesNotMatch(serialized, new RegExp(C.deniedB));
    assert.doesNotMatch(serialized, /father/);
  });

  it("staff assignee can see B", async () => {
    const summary = await getCustomerHouseholdDetailSummary(db, staffA, {
      id: C.assigneeA,
    });
    assert.ok(summary);
    assert.equal(summary.members.some((m) => m.customerId === C.assigneeB), true);
  });

  it("public-pool member is protected for staff", async () => {
    const summary = await getCustomerHouseholdDetailSummary(db, staffA, {
      id: C.poolA,
    });
    assert.ok(summary);
    assert.equal(summary.members.length, 0);
    assert.equal(summary.hasProtectedMembers, true);
    assert.doesNotMatch(JSON.stringify(summary), new RegExp(C.poolB));
  });

  it("admin sees public-pool family member", async () => {
    const summary = await getCustomerHouseholdDetailSummary(db, admin, {
      id: C.poolA,
    });
    assert.ok(summary);
    assert.equal(summary.members.some((m) => m.customerId === C.poolB), true);
  });

  it("archived member visible to owner staff", async () => {
    const summary = await getCustomerHouseholdDetailSummary(db, staffA, {
      id: C.archA,
    });
    assert.ok(summary);
    assert.equal(summary.members.some((m) => m.customerId === C.archB), true);
  });

  it("archived member protected from unrelated staff", async () => {
    const summary = await getCustomerHouseholdDetailSummary(db, staffB, {
      id: C.archA,
    });
    assert.ok(summary);
    assert.equal(summary.hasProtectedMembers, true);
    assert.doesNotMatch(JSON.stringify(summary), new RegExp(C.archB));
  });

  it("soft-deleted member is excluded entirely", async () => {
    const summary = await getCustomerHouseholdDetailSummary(db, admin, {
      id: C.softA,
    });
    assert.equal(summary, null);
  });

  it("historical membership excluded", async () => {
    const summary = await getCustomerHouseholdDetailSummary(db, admin, {
      id: C.histA,
    });
    assert.equal(summary, null);
  });

  it("dissolved household returns null", async () => {
    const summary = await getCustomerHouseholdDetailSummary(db, admin, {
      id: C.dissolvedA,
    });
    assert.equal(summary, null);
  });

  it("inverse relationship uses canonical inverse map", async () => {
    const summary = await getCustomerHouseholdDetailSummary(db, admin, {
      id: C.inverseA,
    });
    assert.ok(summary);
    assert.equal(summary.members[0]?.relationshipType, "parent");
  });

  it("missing relationship shows null relationshipType", async () => {
    const summary = await getCustomerHouseholdDetailSummary(db, admin, {
      id: C.missingA,
    });
    assert.ok(summary);
    assert.equal(summary.members[0]?.relationshipType, null);
  });

  it("malformed reverse pair prefers direct relationship", async () => {
    const summary = await getCustomerHouseholdDetailSummary(db, admin, {
      id: C.malformedA,
    });
    assert.ok(summary);
    assert.equal(summary.members[0]?.relationshipType, "father");
  });

  it("singleton household returns null", async () => {
    const summary = await getCustomerHouseholdDetailSummary(db, admin, {
      id: C.singleton,
    });
    assert.equal(summary, null);
  });

  it("resolveRelationshipFromCurrentPerspective prefers direct row", () => {
    assert.equal(
      resolveRelationshipFromCurrentPerspective("father", "son"),
      "father",
    );
    assert.equal(resolveRelationshipFromCurrentPerspective(null, "son"), "parent");
    assert.equal(resolveRelationshipFromCurrentPerspective(null, null), null);
  });

  it("uses one bounded db.select operation", () => {
    const source = readFileSync(
      "src/lib/customers/households/detail-summary.ts",
      "utf8",
    );
    assert.match(source, /db\s*\n?\s*\.select\(/);
    assert.doesNotMatch(source, /\.map\(async|listCustomerAssignees\(/);
  });
});
