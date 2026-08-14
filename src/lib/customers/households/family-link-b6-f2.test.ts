import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import type { User } from "../../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { submitFamilyRelationshipUpdate } from "./family-management-approval";
import { executeFamilyLink } from "./link-existing";

const NOW = "2026-08-14T10:00:00.000Z";
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const REV_A = "b6f2-rev-a";
const REV_B = "b6f2-rev-b";
const DIR_A = "b6f2-dir-a";
const DIR_B = "b6f2-dir-b";

const ALL_B6F2_IDS = [REV_A, REV_B, DIR_A, DIR_B] as const;

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function customerRow(
  id: string,
  ownerId: string,
  overrides: Partial<typeof schema.customers.$inferInsert> = {},
) {
  return {
    id,
    customerName: `B6F2 ${id}`,
    customerType: "individual" as const,
    source: "referral",
    ownerId,
    status: "active" as const,
    createdBy: ownerId,
    updatedBy: ownerId,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

async function deleteCustomerGraph(db: TestDb, customerId: string) {
  await db
    .delete(schema.customerHouseholdRelationships)
    .where(
      or(
        eq(schema.customerHouseholdRelationships.fromCustomerId, customerId),
        eq(schema.customerHouseholdRelationships.toCustomerId, customerId),
      ),
    );
  await db
    .delete(schema.customerHouseholdMembers)
    .where(eq(schema.customerHouseholdMembers.customerId, customerId));
  await db
    .delete(schema.customerAssignees)
    .where(eq(schema.customerAssignees.customerId, customerId));
  await db
    .delete(schema.approvals)
    .where(
      or(
        eq(schema.approvals.customerId, customerId),
        sql`json_extract(${schema.approvals.relatedCustomerIds}, '$[0]') = ${customerId}`,
      ),
    );
  await db.delete(schema.customers).where(eq(schema.customers.id, customerId));
}

async function cleanupB6F2Artifacts(db: TestDb) {
  for (const id of ALL_B6F2_IDS) {
    await deleteCustomerGraph(db, id);
  }

  const stray = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(sql`${schema.customers.id} LIKE 'b6f2-%'`);

  for (const row of stray) {
    await deleteCustomerGraph(db, row.id);
  }
}

async function getCustomer(db: TestDb, id: string) {
  const row = (
    await db.select().from(schema.customers).where(eq(schema.customers.id, id)).limit(1)
  )[0];
  assert.ok(row, `missing customer ${id}`);
  return row;
}

async function linkInHousehold(
  db: TestDb,
  sourceId: string,
  targetId: string,
  relationshipType: string,
  actor: User = staffA,
) {
  const source = await getCustomer(db, sourceId);
  const target = await getCustomer(db, targetId);
  return executeFamilyLink(db, {
    source,
    target,
    relationshipType: relationshipType as "father",
    actor,
  });
}

async function resetB6F2HouseholdState(db: TestDb) {
  const ids = (
    await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(sql`${schema.customers.id} LIKE 'b6f2-%'`)
  ).map((row) => row.id);

  if (ids.length === 0) return;

  await db
    .delete(schema.customerHouseholdRelationships)
    .where(
      or(
        inArray(schema.customerHouseholdRelationships.fromCustomerId, ids),
        inArray(schema.customerHouseholdRelationships.toCustomerId, ids),
      ),
    );
  await db
    .delete(schema.customerHouseholdMembers)
    .where(inArray(schema.customerHouseholdMembers.customerId, ids));
  await db
    .delete(schema.customerHouseholds)
    .where(inArray(schema.customerHouseholds.createdFromCustomerId, ids));
  await db.delete(schema.approvals).where(
    or(
      inArray(schema.approvals.customerId, ids),
      sql`json_extract(${schema.approvals.relatedCustomerIds}, '$[0]') IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    ),
  );
}

async function relationshipsForPair(db: TestDb, aId: string, bId: string) {
  return db
    .select()
    .from(schema.customerHouseholdRelationships)
    .where(
      or(
        and(
          eq(schema.customerHouseholdRelationships.fromCustomerId, aId),
          eq(schema.customerHouseholdRelationships.toCustomerId, bId),
        ),
        and(
          eq(schema.customerHouseholdRelationships.fromCustomerId, bId),
          eq(schema.customerHouseholdRelationships.toCustomerId, aId),
        ),
      ),
    );
}

describe("B6-F2 edit relationship modal submission", () => {
  it("does not short-circuit submit when selected relationship matches displayed currentRelationship", () => {
    const modal = read("src/components/customers/customer-family-edit-relationship-modal.tsx");
    const submitStart = modal.indexOf("async function handleSubmit()");
    const submitEnd = modal.indexOf("if (!open)", submitStart);
    const handleSubmit = modal.slice(submitStart, submitEnd);

    assert.doesNotMatch(
      handleSubmit,
      /relationshipType\s*===\s*currentRelationship/,
      "client must not treat matching source-perspective labels as a no-op",
    );
    assert.match(handleSubmit, /fetch\(/);
    assert.match(
      handleSubmit,
      /\/api\/customers\/\$\{customerId\}\/family\/members\/\$\{targetCustomerId\}\/relationship/,
    );
  });

  it("still allows parent display label without inventing a client-side no-op branch", () => {
    const modal = read("src/components/customers/customer-family-edit-relationship-modal.tsx");
    assert.match(modal, /currentRelationship === "parent"/);
    assert.doesNotMatch(
      modal,
      /currentRelationship !== "parent"[\s\S]*relationshipType === currentRelationship/,
    );
  });
});

describe("B6-F2 server-authoritative relationship submission", () => {
  let db: TestDb;
  let dispose: (() => Promise<void>) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({ configPath: "./wrangler.jsonc" });
    dispose = proxy.dispose;
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    await cleanupB6F2Artifacts(db);
    await db.insert(schema.customers).values([
      customerRow(REV_A, SEED_IDS.staffA),
      customerRow(REV_B, SEED_IDS.staffA),
      customerRow(DIR_A, SEED_IDS.staffA),
      customerRow(DIR_B, SEED_IDS.staffA),
    ]);
  });

  beforeEach(async () => {
    await resetB6F2HouseholdState(db);
  });

  after(async () => {
    await cleanupB6F2Artifacts(db);
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("reverse stored B→A father + source selects child → backend normalizes to A→B child", async () => {
    await linkInHousehold(db, REV_B, REV_A, "father");
    const source = await getCustomer(db, REV_A);

    const result = await submitFamilyRelationshipUpdate(
      db,
      source,
      staffA,
      REV_B,
      "child",
    );

    assert.equal(result.mode, "direct");
    if (result.mode === "direct") {
      assert.equal(result.kind, "updated");
    }

    const rels = await relationshipsForPair(db, REV_A, REV_B);
    assert.equal(rels.length, 1);
    assert.equal(rels[0]?.fromCustomerId, REV_A);
    assert.equal(rels[0]?.toCustomerId, REV_B);
    assert.equal(rels[0]?.relationshipType, "child");
  });

  it("direct stored A→B father + source selects father → backend returns no_change", async () => {
    await linkInHousehold(db, DIR_A, DIR_B, "father");
    const beforeCount = (await db.select().from(schema.customerHouseholdRelationships))
      .length;
    const source = await getCustomer(db, DIR_A);

    const result = await submitFamilyRelationshipUpdate(
      db,
      source,
      staffA,
      DIR_B,
      "father",
    );

    assert.equal(result.mode, "direct");
    if (result.mode === "direct") {
      assert.equal(result.kind, "no_change");
    }

    const afterCount = (await db.select().from(schema.customerHouseholdRelationships))
      .length;
    assert.equal(afterCount, beforeCount);

    const rels = await relationshipsForPair(db, DIR_A, DIR_B);
    assert.equal(rels.length, 1);
    assert.equal(rels[0]?.fromCustomerId, DIR_A);
    assert.equal(rels[0]?.toCustomerId, DIR_B);
    assert.equal(rels[0]?.relationshipType, "father");
  });
});
