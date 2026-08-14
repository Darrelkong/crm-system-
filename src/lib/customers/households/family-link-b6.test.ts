import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import type { User } from "../../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  approveApprovalRequest,
  ApprovalError,
  rejectApprovalRequest,
} from "@/lib/approvals/service";
import { getApprovalById } from "@/lib/approvals/queries";
import {
  loadFamilyManagementAdminDetails,
  sanitizeApprovalListItemForUser,
} from "@/lib/approvals/family-link-serialization";
import type { ApprovalListItem } from "@/lib/approvals/queries";
import { validateApprovalRequestInput } from "@/lib/approvals/validation";
import {
  findPendingFamilyManagementPair,
  submitFamilyRelationshipUpdate,
  submitFamilyUnlink,
} from "./family-management-approval";
import { executeRelationshipUpdate } from "./family-relationship-update";
import { executeFamilyUnlink } from "./family-unlink";
import { executeFamilyLink } from "./link-existing";
import { FAMILY_ERROR_CODES, FamilyLinkError } from "./errors";

const NOW = "2026-08-14T10:00:00.000Z";
const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;

const REL_A = "b6-rel-a";
const REL_B = "b6-rel-b";
const INV_A = "b6-inv-a";
const INV_B = "b6-inv-b";
const UNL_F_A = "b6-unl-f-a";
const UNL_F_B = "b6-unl-f-b";
const UNL_G_A = "b6-unl-g-a";
const UNL_G_B = "b6-unl-g-b";
const UNL_G_C = "b6-unl-g-c";
const UNL_H_A = "b6-unl-h-a";
const UNL_H_B = "b6-unl-h-b";
const UNL_H_C = "b6-unl-h-c";
const PERM_I_A = "b6-perm-i-a";
const PERM_I_B = "b6-perm-i-b";
const PERM_J_A = "b6-perm-j-a";
const PERM_J_B = "b6-perm-j-b";
const PERM_K_A = "b6-perm-k-a";
const PERM_K_B = "b6-perm-k-b";
const PERM_L_A = "b6-perm-l-a";
const PERM_L_B = "b6-perm-l-b";
const PERM_M_A = "b6-perm-m-a";
const PERM_M_B = "b6-perm-m-b";
const PERM_N_A = "b6-perm-n-a";
const PERM_N_COMPANY = "b6-perm-n-company";
const APR_O_A = "b6-apr-o-a";
const APR_O_B = "b6-apr-o-b";
const APR_P_A = "b6-apr-p-a";
const APR_P_B = "b6-apr-p-b";
const APR_Q_A = "b6-apr-q-a";
const APR_Q_B = "b6-apr-q-b";
const APR_R_A = "b6-apr-r-a";
const APR_R_B = "b6-apr-r-b";
const APR_S_A = "b6-apr-s-a";
const APR_S_B = "b6-apr-s-b";
const APR_S_C = "b6-apr-s-c";
const APR_T_A = "b6-apr-t-a";
const APR_T_B = "b6-apr-t-b";
const APR_U_A = "b6-apr-u-a";
const APR_U_B = "b6-apr-u-b";
const SER_A = "b6-ser-a";
const SER_B = "b6-ser-b";
const RBK_DIR_A = "b6-rbk-dir-a";
const RBK_DIR_B = "b6-rbk-dir-b";
const RBK_APR_A = "b6-rbk-apr-a";
const RBK_APR_B = "b6-rbk-apr-b";

const ALL_B6_IDS = [
  REL_A,
  REL_B,
  INV_A,
  INV_B,
  UNL_F_A,
  UNL_F_B,
  UNL_G_A,
  UNL_G_B,
  UNL_G_C,
  UNL_H_A,
  UNL_H_B,
  UNL_H_C,
  PERM_I_A,
  PERM_I_B,
  PERM_J_A,
  PERM_J_B,
  PERM_K_A,
  PERM_K_B,
  PERM_L_A,
  PERM_L_B,
  PERM_M_A,
  PERM_M_B,
  PERM_N_A,
  PERM_N_COMPANY,
  APR_O_A,
  APR_O_B,
  APR_P_A,
  APR_P_B,
  APR_Q_A,
  APR_Q_B,
  APR_R_A,
  APR_R_B,
  APR_S_A,
  APR_S_B,
  APR_S_C,
  APR_T_A,
  APR_T_B,
  APR_U_A,
  APR_U_B,
  SER_A,
  SER_B,
  RBK_DIR_A,
  RBK_DIR_B,
  RBK_APR_A,
  RBK_APR_B,
] as const;

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function customerRow(
  id: string,
  ownerId: string,
  overrides: Partial<typeof schema.customers.$inferInsert> = {},
) {
  return {
    id,
    customerName: `B6 ${id}`,
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

async function cleanupB6Artifacts(db: TestDb) {
  for (const id of ALL_B6_IDS) {
    await deleteCustomerGraph(db, id);
  }

  const stray = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(sql`${schema.customers.id} LIKE 'b6-%'`);

  for (const row of stray) {
    await deleteCustomerGraph(db, row.id);
  }
}

async function seedCustomers(
  db: TestDb,
  rows: Array<typeof schema.customers.$inferInsert>,
) {
  for (const row of rows) {
    await db.insert(schema.customers).values(row);
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

async function countHouseholdTables(db: TestDb) {
  const [households, members, relationships] = await Promise.all([
    db.select().from(schema.customerHouseholds),
    db
      .select()
      .from(schema.customerHouseholdMembers)
      .where(isNull(schema.customerHouseholdMembers.leftAt)),
    db.select().from(schema.customerHouseholdRelationships),
  ]);
  return {
    households: households.length,
    members: members.length,
    relationships: relationships.length,
  };
}

async function resetB6HouseholdState(db: TestDb) {
  const b6Ids = (
    await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(sql`${schema.customers.id} LIKE 'b6-%'`)
  ).map((row) => row.id);

  if (b6Ids.length === 0) return;

  await db
    .delete(schema.customerHouseholdRelationships)
    .where(
      or(
        inArray(schema.customerHouseholdRelationships.fromCustomerId, b6Ids),
        inArray(schema.customerHouseholdRelationships.toCustomerId, b6Ids),
      ),
    );
  await db
    .delete(schema.customerHouseholdMembers)
    .where(inArray(schema.customerHouseholdMembers.customerId, b6Ids));
  await db
    .delete(schema.customerHouseholds)
    .where(inArray(schema.customerHouseholds.createdFromCustomerId, b6Ids));
  await db.delete(schema.approvals).where(
    or(
      inArray(schema.approvals.customerId, b6Ids),
      sql`json_extract(${schema.approvals.relatedCustomerIds}, '$[0]') IN (${sql.join(
        b6Ids.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    ),
  );
}

async function getHouseholdIdForCustomer(db: TestDb, customerId: string) {
  const row = (
    await db
      .select({ householdId: schema.customerHouseholdMembers.householdId })
      .from(schema.customerHouseholdMembers)
      .where(
        and(
          eq(schema.customerHouseholdMembers.customerId, customerId),
          isNull(schema.customerHouseholdMembers.leftAt),
        ),
      )
      .limit(1)
  )[0];
  assert.ok(row?.householdId);
  return row.householdId;
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

async function setupHouseholdWithoutRelationship(
  db: TestDb,
  aId: string,
  bId: string,
) {
  await linkInHousehold(db, aId, bId, "father");
  await db
    .delete(schema.customerHouseholdRelationships)
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

async function insertRelationshipRow(
  db: TestDb,
  householdId: string,
  fromId: string,
  toId: string,
  relationshipType: string,
) {
  await db.insert(schema.customerHouseholdRelationships).values({
    id: crypto.randomUUID(),
    householdId,
    fromCustomerId: fromId,
    toCustomerId: toId,
    relationshipType: relationshipType as "father",
    createdBy: SEED_IDS.admin,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

async function setupIndividualWithCompanyMember(
  db: TestDb,
  individualId: string,
  companyId: string,
) {
  const householdId = crypto.randomUUID();
  await db.insert(schema.customerHouseholds).values({
    id: householdId,
    status: "active",
    createdFromCustomerId: individualId,
    createdBy: SEED_IDS.staffA,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(schema.customerHouseholdMembers).values([
    {
      id: crypto.randomUUID(),
      householdId,
      customerId: individualId,
      joinedAt: NOW,
      joinedBy: SEED_IDS.staffA,
    },
    {
      id: crypto.randomUUID(),
      householdId,
      customerId: companyId,
      joinedAt: NOW,
      joinedBy: SEED_IDS.staffA,
    },
  ]);
  return householdId;
}

function approvalListItemFromApproval(
  approval: NonNullable<Awaited<ReturnType<typeof getApprovalById>>>,
  customerName: string,
): ApprovalListItem {
  let relatedCustomerIds: string[] | null = null;
  if (approval.relatedCustomerIds) {
    try {
      const parsed = JSON.parse(approval.relatedCustomerIds) as unknown;
      relatedCustomerIds = Array.isArray(parsed) ? parsed.map(String) : null;
    } catch {
      relatedCustomerIds = null;
    }
  }

  let payload: Record<string, unknown> | null = null;
  if (approval.payload) {
    try {
      payload = JSON.parse(approval.payload) as Record<string, unknown>;
    } catch {
      payload = null;
    }
  }

  return {
    id: approval.id,
    requestType: approval.requestType,
    status: approval.status,
    customerId: approval.customerId,
    customerName,
    nameStatus: "active",
    requestedBy: approval.requestedBy,
    requestedByName: "Staff A",
    targetUserId: approval.targetUserId,
    targetUserName: null,
    relatedCustomerIds,
    payload,
    reason: approval.reason,
    adminComment: approval.adminComment,
    reviewedBy: approval.reviewedBy,
    reviewedAt: approval.reviewedAt,
    createdAt: approval.createdAt,
    updatedAt: approval.updatedAt,
  };
}

describe("family link B6 management", () => {
  let dispose: (() => Promise<void>) | undefined;
  let db: TestDb;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({ configPath: "./wrangler.jsonc" });
    dispose = proxy.dispose;
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);

    await cleanupB6Artifacts(db);

    await seedCustomers(db, [
      customerRow(REL_A, SEED_IDS.staffA),
      customerRow(REL_B, SEED_IDS.staffA),
      customerRow(INV_A, SEED_IDS.staffA),
      customerRow(INV_B, SEED_IDS.staffA),
      customerRow(UNL_F_A, SEED_IDS.staffA),
      customerRow(UNL_F_B, SEED_IDS.staffA),
      customerRow(UNL_G_A, SEED_IDS.staffA),
      customerRow(UNL_G_B, SEED_IDS.staffA),
      customerRow(UNL_G_C, SEED_IDS.staffA),
      customerRow(UNL_H_A, SEED_IDS.staffA),
      customerRow(UNL_H_B, SEED_IDS.staffA),
      customerRow(UNL_H_C, SEED_IDS.staffA, { deletedAt: NOW }),
      customerRow(PERM_I_A, SEED_IDS.staffA),
      customerRow(PERM_I_B, SEED_IDS.staffA),
      customerRow(PERM_J_A, SEED_IDS.staffA),
      customerRow(PERM_J_B, SEED_IDS.staffA),
      customerRow(PERM_K_A, SEED_IDS.staffA),
      customerRow(PERM_K_B, SEED_IDS.staffB),
      customerRow(PERM_L_A, SEED_IDS.staffA),
      customerRow(PERM_L_B, SEED_IDS.staffA),
      customerRow(PERM_M_A, SEED_IDS.staffA),
      customerRow(PERM_M_B, SEED_IDS.staffA, { status: "archived" }),
      customerRow(PERM_N_A, SEED_IDS.staffA),
      customerRow(PERM_N_COMPANY, SEED_IDS.staffA, { customerType: "company" }),
      customerRow(APR_O_A, SEED_IDS.staffA),
      customerRow(APR_O_B, SEED_IDS.staffB),
      customerRow(APR_P_A, SEED_IDS.staffA),
      customerRow(APR_P_B, SEED_IDS.staffB),
      customerRow(APR_Q_A, SEED_IDS.staffA),
      customerRow(APR_Q_B, SEED_IDS.staffB),
      customerRow(APR_R_A, SEED_IDS.staffA),
      customerRow(APR_R_B, SEED_IDS.staffB),
      customerRow(APR_S_A, SEED_IDS.staffA),
      customerRow(APR_S_B, SEED_IDS.staffB),
      customerRow(APR_S_C, SEED_IDS.staffA),
      customerRow(APR_T_A, SEED_IDS.staffA),
      customerRow(APR_T_B, SEED_IDS.staffB),
      customerRow(APR_U_A, SEED_IDS.staffA),
      customerRow(APR_U_B, SEED_IDS.staffB),
      customerRow(SER_A, SEED_IDS.staffA),
      customerRow(SER_B, SEED_IDS.staffB),
      customerRow(RBK_DIR_A, SEED_IDS.staffA),
      customerRow(RBK_DIR_B, SEED_IDS.staffA),
      customerRow(RBK_APR_A, SEED_IDS.staffA),
      customerRow(RBK_APR_B, SEED_IDS.staffB),
    ]);

    await db.insert(schema.customerAssignees).values({
      id: "b6-assignee-staffb-l-a",
      customerId: PERM_L_A,
      userId: SEED_IDS.staffB,
      role: "collaborator",
      assignedBy: SEED_IDS.admin,
      assignedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  after(async () => {
    await cleanupB6Artifacts(db);
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  describe("direct relationship (A-E)", () => {
    beforeEach(async () => {
      await resetB6HouseholdState(db);
    });

    it("A: direct A→B father, edit to spouse → one A→B spouse row", async () => {
      await linkInHousehold(db, REL_A, REL_B, "father");
      const source = await getCustomer(db, REL_A);

      const result = await submitFamilyRelationshipUpdate(
        db,
        source,
        staffA,
        REL_B,
        "spouse",
      );
      assert.equal(result.mode, "direct");
      if (result.mode === "direct") {
        assert.equal(result.kind, "updated");
      }

      const rels = await relationshipsForPair(db, REL_A, REL_B);
      assert.equal(rels.length, 1);
      assert.equal(rels[0]?.fromCustomerId, REL_A);
      assert.equal(rels[0]?.toCustomerId, REL_B);
      assert.equal(rels[0]?.relationshipType, "spouse");
    });

    it("B: reverse B→A child stored, from A edit to father → reverse removed, one A→B father", async () => {
      await linkInHousehold(db, REL_B, REL_A, "child");
      const source = await getCustomer(db, REL_A);

      const result = await submitFamilyRelationshipUpdate(
        db,
        source,
        staffA,
        REL_B,
        "father",
      );
      assert.equal(result.mode, "direct");
      if (result.mode === "direct") {
        assert.equal(result.kind, "updated");
      }

      const rels = await relationshipsForPair(db, REL_A, REL_B);
      assert.equal(rels.length, 1);
      assert.equal(rels[0]?.fromCustomerId, REL_A);
      assert.equal(rels[0]?.toCustomerId, REL_B);
      assert.equal(rels[0]?.relationshipType, "father");
    });

    it("C: A+B same household no relationship → set mother → one A→B mother", async () => {
      await setupHouseholdWithoutRelationship(db, REL_A, REL_B);
      const source = await getCustomer(db, REL_A);

      const result = await submitFamilyRelationshipUpdate(
        db,
        source,
        staffA,
        REL_B,
        "mother",
      );
      assert.equal(result.mode, "direct");
      if (result.mode === "direct") {
        assert.equal(result.kind, "updated");
      }

      const rels = await relationshipsForPair(db, REL_A, REL_B);
      assert.equal(rels.length, 1);
      assert.equal(rels[0]?.fromCustomerId, REL_A);
      assert.equal(rels[0]?.toCustomerId, REL_B);
      assert.equal(rels[0]?.relationshipType, "mother");
    });

    it("D: same relationship selected → no_change, no relationship row count change", async () => {
      await linkInHousehold(db, REL_A, REL_B, "father");
      const beforeCount = (await db.select().from(schema.customerHouseholdRelationships))
        .length;
      const source = await getCustomer(db, REL_A);

      const result = await submitFamilyRelationshipUpdate(
        db,
        source,
        staffA,
        REL_B,
        "father",
      );
      assert.equal(result.mode, "direct");
      if (result.mode === "direct") {
        assert.equal(result.kind, "no_change");
      }

      const afterCount = (await db.select().from(schema.customerHouseholdRelationships))
        .length;
      assert.equal(afterCount, beforeCount);
    });

    it("E: both A→B and B→A exist → 409 INVALID_HOUSEHOLD_STATE, no mutation", async () => {
      await linkInHousehold(db, INV_A, INV_B, "father");
      const householdId = await getHouseholdIdForCustomer(db, INV_A);
      await insertRelationshipRow(db, householdId, INV_B, INV_A, "mother");
      const source = await getCustomer(db, INV_A);
      const beforeRels = await relationshipsForPair(db, INV_A, INV_B);

      await assert.rejects(
        () =>
          submitFamilyRelationshipUpdate(db, source, staffA, INV_B, "spouse"),
        (error: unknown) =>
          error instanceof FamilyLinkError &&
          error.errorCode === FAMILY_ERROR_CODES.INVALID_HOUSEHOLD_STATE,
      );

      const afterRels = await relationshipsForPair(db, INV_A, INV_B);
      assert.equal(afterRels.length, beforeRels.length);
    });
  });

  describe("unlink (F-H)", () => {
    beforeEach(async () => {
      await resetB6HouseholdState(db);
    });

    it("F: two-member household unlink B → dissolved, both historical memberships, 0 relationships, customers unchanged", async () => {
      await linkInHousehold(db, UNL_F_A, UNL_F_B, "father");
      const householdId = await getHouseholdIdForCustomer(db, UNL_F_A);
      const source = await getCustomer(db, UNL_F_A);
      const customersBefore = (
        await db
          .select()
          .from(schema.customers)
          .where(inArray(schema.customers.id, [UNL_F_A, UNL_F_B]))
      ).length;

      const result = await submitFamilyUnlink(db, source, staffA, UNL_F_B);
      assert.equal(result.mode, "direct");
      if (result.mode === "direct") {
        assert.equal(result.householdAction, "household_dissolved");
      }

      const household = (
        await db
          .select()
          .from(schema.customerHouseholds)
          .where(eq(schema.customerHouseholds.id, householdId))
          .limit(1)
      )[0];
      assert.equal(household?.status, "dissolved");

      const activeMembers = await db
        .select()
        .from(schema.customerHouseholdMembers)
        .where(
          and(
            eq(schema.customerHouseholdMembers.householdId, householdId),
            isNull(schema.customerHouseholdMembers.leftAt),
          ),
        );
      assert.equal(activeMembers.length, 0);

      const historicalMembers = await db
        .select()
        .from(schema.customerHouseholdMembers)
        .where(
          and(
            eq(schema.customerHouseholdMembers.householdId, householdId),
            sql`${schema.customerHouseholdMembers.leftAt} IS NOT NULL`,
          ),
        );
      assert.equal(historicalMembers.length, 2);

      const relationships = await db
        .select()
        .from(schema.customerHouseholdRelationships)
        .where(eq(schema.customerHouseholdRelationships.householdId, householdId));
      assert.equal(relationships.length, 0);

      const customersAfter = (
        await db
          .select()
          .from(schema.customers)
          .where(inArray(schema.customers.id, [UNL_F_A, UNL_F_B]))
      ).length;
      assert.equal(customersAfter, customersBefore);
    });

    it("G: three members A,B,C with A↔B, B↔C, A↔C - remove B → B left, B rels deleted, A↔C preserved, household active", async () => {
      await linkInHousehold(db, UNL_G_A, UNL_G_B, "father");
      const householdId = await getHouseholdIdForCustomer(db, UNL_G_A);

      await db.insert(schema.customerHouseholdMembers).values({
        id: crypto.randomUUID(),
        householdId,
        customerId: UNL_G_C,
        joinedAt: NOW,
        joinedBy: SEED_IDS.staffA,
      });
      await insertRelationshipRow(db, householdId, UNL_G_B, UNL_G_C, "father");
      await insertRelationshipRow(db, householdId, UNL_G_A, UNL_G_C, "mother");

      const source = await getCustomer(db, UNL_G_A);
      const result = await submitFamilyUnlink(db, source, staffA, UNL_G_B);
      assert.equal(result.mode, "direct");
      if (result.mode === "direct") {
        assert.equal(result.householdAction, "member_removed");
      }

      const bMembership = await db
        .select()
        .from(schema.customerHouseholdMembers)
        .where(eq(schema.customerHouseholdMembers.customerId, UNL_G_B));
      assert.ok(bMembership[0]?.leftAt);

      const bRels = await db
        .select()
        .from(schema.customerHouseholdRelationships)
        .where(
          or(
            eq(schema.customerHouseholdRelationships.fromCustomerId, UNL_G_B),
            eq(schema.customerHouseholdRelationships.toCustomerId, UNL_G_B),
          ),
        );
      assert.equal(bRels.length, 0);

      const acRels = await relationshipsForPair(db, UNL_G_A, UNL_G_C);
      assert.equal(acRels.length, 1);

      const household = (
        await db
          .select()
          .from(schema.customerHouseholds)
          .where(eq(schema.customerHouseholds.id, householdId))
          .limit(1)
      )[0];
      assert.equal(household?.status, "active");
    });

    it("H: A,B active + C soft-deleted but membership active, remove B → household stays active, 2 active memberships", async () => {
      await linkInHousehold(db, UNL_H_A, UNL_H_B, "father");
      const householdId = await getHouseholdIdForCustomer(db, UNL_H_A);

      await db.insert(schema.customerHouseholdMembers).values({
        id: crypto.randomUUID(),
        householdId,
        customerId: UNL_H_C,
        joinedAt: NOW,
        joinedBy: SEED_IDS.staffA,
      });

      const source = await getCustomer(db, UNL_H_A);
      const result = await submitFamilyUnlink(db, source, staffA, UNL_H_B);
      assert.equal(result.mode, "direct");
      if (result.mode === "direct") {
        assert.equal(result.householdAction, "member_removed");
      }

      const household = (
        await db
          .select()
          .from(schema.customerHouseholds)
          .where(eq(schema.customerHouseholds.id, householdId))
          .limit(1)
      )[0];
      assert.equal(household?.status, "active");

      const activeMembers = await db
        .select()
        .from(schema.customerHouseholdMembers)
        .where(
          and(
            eq(schema.customerHouseholdMembers.householdId, householdId),
            isNull(schema.customerHouseholdMembers.leftAt),
          ),
        );
      assert.equal(activeMembers.length, 2);
      assert.ok(activeMembers.some((row) => row.customerId === UNL_H_A));
      assert.ok(activeMembers.some((row) => row.customerId === UNL_H_C));
    });
  });

  describe("permissions (I-N)", () => {
    beforeEach(async () => {
      await resetB6HouseholdState(db);
    });

    it("I: admin direct relationship update", async () => {
      await linkInHousehold(db, PERM_I_A, PERM_I_B, "father");
      const source = await getCustomer(db, PERM_I_A);

      const result = await submitFamilyRelationshipUpdate(
        db,
        source,
        admin,
        PERM_I_B,
        "mother",
      );
      assert.equal(result.mode, "direct");
      if (result.mode === "direct") {
        assert.equal(result.kind, "updated");
      }
    });

    it("J: staff owns both → direct", async () => {
      await linkInHousehold(db, PERM_J_A, PERM_J_B, "father");
      const source = await getCustomer(db, PERM_J_A);

      const result = await submitFamilyRelationshipUpdate(
        db,
        source,
        staffA,
        PERM_J_B,
        "spouse",
      );
      assert.equal(result.mode, "direct");
    });

    it("K: staff owns source, target cross-owner (staffB) → approval created", async () => {
      await linkInHousehold(db, PERM_K_A, PERM_K_B, "father");
      const source = await getCustomer(db, PERM_K_A);

      const result = await submitFamilyRelationshipUpdate(
        db,
        source,
        staffA,
        PERM_K_B,
        "mother",
      );
      assert.equal(result.mode, "approval");
      if (result.mode === "approval") {
        const approval = await getApprovalById(db, result.approvalId);
        assert.equal(approval?.requestType, "update_family_relationship");
        assert.equal(approval?.status, "pending");
      }
    });

    it("L: staff assignee-only on source without owner → forbidden SOURCE_NOT_ELIGIBLE", async () => {
      await linkInHousehold(db, PERM_L_A, PERM_L_B, "father");
      const source = await getCustomer(db, PERM_L_A);

      await assert.rejects(
        () =>
          submitFamilyRelationshipUpdate(db, source, staffB, PERM_L_B, "mother"),
        (error: unknown) =>
          error instanceof FamilyLinkError &&
          error.errorCode === FAMILY_ERROR_CODES.SOURCE_NOT_ELIGIBLE,
      );
    });

    it("M: archived target - admin can unlink", async () => {
      await linkInHousehold(db, PERM_M_A, PERM_M_B, "father");
      const source = await getCustomer(db, PERM_M_A);

      const result = await submitFamilyUnlink(db, source, admin, PERM_M_B);
      assert.equal(result.mode, "direct");
      if (result.mode === "direct") {
        assert.equal(result.householdAction, "household_dissolved");
      }
    });

    it("N: company member in household - admin unlink allowed; edit relationship throws COMPANY_MEMBER_EDIT_FORBIDDEN", async () => {
      await setupIndividualWithCompanyMember(db, PERM_N_A, PERM_N_COMPANY);
      const source = await getCustomer(db, PERM_N_A);

      const unlinkResult = await submitFamilyUnlink(db, source, admin, PERM_N_COMPANY);
      assert.equal(unlinkResult.mode, "direct");

      await setupIndividualWithCompanyMember(db, PERM_N_A, PERM_N_COMPANY);

      await assert.rejects(
        () =>
          submitFamilyRelationshipUpdate(db, source, admin, PERM_N_COMPANY, "mother"),
        (error: unknown) =>
          error instanceof FamilyLinkError &&
          error.errorCode === FAMILY_ERROR_CODES.COMPANY_MEMBER_EDIT_FORBIDDEN,
      );
    });
  });

  describe("approval (O-U)", () => {
    beforeEach(async () => {
      await resetB6HouseholdState(db);
    });

    it("O: relationship update approval → approve → relation changed, approval approved", async () => {
      await linkInHousehold(db, APR_O_A, APR_O_B, "father");
      const source = await getCustomer(db, APR_O_A);

      const pending = await submitFamilyRelationshipUpdate(
        db,
        source,
        staffA,
        APR_O_B,
        "mother",
      );
      assert.equal(pending.mode, "approval");
      if (pending.mode !== "approval") return;

      await approveApprovalRequest(pending.approvalId, admin);

      const approval = await getApprovalById(db, pending.approvalId);
      assert.equal(approval?.status, "approved");

      const rels = await relationshipsForPair(db, APR_O_A, APR_O_B);
      assert.equal(rels[0]?.relationshipType, "mother");
    });

    it("P: unlink approval → approve → target removed", async () => {
      await linkInHousehold(db, APR_P_A, APR_P_B, "father");
      const source = await getCustomer(db, APR_P_A);

      const pending = await submitFamilyUnlink(db, source, staffA, APR_P_B);
      assert.equal(pending.mode, "approval");
      if (pending.mode !== "approval") return;

      await approveApprovalRequest(pending.approvalId, admin);

      const approval = await getApprovalById(db, pending.approvalId);
      assert.equal(approval?.status, "approved");

      const activeMembers = await db
        .select()
        .from(schema.customerHouseholdMembers)
        .where(
          and(
            eq(schema.customerHouseholdMembers.customerId, APR_P_B),
            isNull(schema.customerHouseholdMembers.leftAt),
          ),
        );
      assert.equal(activeMembers.length, 0);
    });

    it("Q: reject approval then try approve stale → 409, no family mutation", async () => {
      await linkInHousehold(db, APR_Q_A, APR_Q_B, "father");
      const source = await getCustomer(db, APR_Q_A);
      const relsBefore = await relationshipsForPair(db, APR_Q_A, APR_Q_B);

      const pending = await submitFamilyRelationshipUpdate(
        db,
        source,
        staffA,
        APR_Q_B,
        "mother",
      );
      assert.equal(pending.mode, "approval");
      if (pending.mode !== "approval") return;

      await rejectApprovalRequest(pending.approvalId, admin);

      await assert.rejects(
        () => approveApprovalRequest(pending.approvalId, admin),
        (error: unknown) =>
          error instanceof ApprovalError && error.status === 409,
      );

      const relsAfter = await relationshipsForPair(db, APR_Q_A, APR_Q_B);
      assert.deepEqual(
        relsAfter.map((row) => row.relationshipType),
        relsBefore.map((row) => row.relationshipType),
      );
    });

    it("R: create update approval, change relationship directly, approve old → FAMILY_APPROVAL_STALE", async () => {
      await linkInHousehold(db, APR_R_A, APR_R_B, "father");
      const source = await getCustomer(db, APR_R_A);

      const pending = await submitFamilyRelationshipUpdate(
        db,
        source,
        staffA,
        APR_R_B,
        "mother",
      );
      assert.equal(pending.mode, "approval");
      if (pending.mode !== "approval") return;

      await executeRelationshipUpdate(db, {
        sourceId: APR_R_A,
        targetId: APR_R_B,
        relationshipType: "spouse",
        actor: admin,
      });

      await assert.rejects(
        () => approveApprovalRequest(pending.approvalId, admin),
        (error: unknown) =>
          error instanceof ApprovalError &&
          error.code === FAMILY_ERROR_CODES.APPROVAL_STALE,
      );
    });

    it("S: unlink approval with stale member count → stale conflict", async () => {
      await linkInHousehold(db, APR_S_A, APR_S_B, "father");
      const householdId = await getHouseholdIdForCustomer(db, APR_S_A);
      const source = await getCustomer(db, APR_S_A);

      const pending = await submitFamilyUnlink(db, source, staffA, APR_S_B);
      assert.equal(pending.mode, "approval");
      if (pending.mode !== "approval") return;

      await db.insert(schema.customerHouseholdMembers).values({
        id: crypto.randomUUID(),
        householdId,
        customerId: APR_S_C,
        joinedAt: NOW,
        joinedBy: SEED_IDS.staffA,
      });

      await assert.rejects(
        () => approveApprovalRequest(pending.approvalId, admin),
        (error: unknown) =>
          error instanceof ApprovalError &&
          error.code === FAMILY_ERROR_CODES.APPROVAL_STALE,
      );
    });

    it("T: pending pair dedup (update+unlink same pair)", async () => {
      await linkInHousehold(db, APR_T_A, APR_T_B, "father");
      const source = await getCustomer(db, APR_T_A);

      const updatePending = await submitFamilyRelationshipUpdate(
        db,
        source,
        staffA,
        APR_T_B,
        "mother",
      );
      assert.equal(updatePending.mode, "approval");

      await assert.rejects(
        () => submitFamilyUnlink(db, source, staffA, APR_T_B),
        (error: unknown) =>
          error instanceof FamilyLinkError &&
          error.errorCode === FAMILY_ERROR_CODES.DUPLICATE_PENDING,
      );

      const existing = await findPendingFamilyManagementPair(db, APR_T_A, APR_T_B);
      assert.ok(existing);
    });

    it("U: concurrent approval creates for same pair → exactly 1 pending", async () => {
      await linkInHousehold(db, APR_U_A, APR_U_B, "father");
      const source = await getCustomer(db, APR_U_A);

      const approvalResults = await Promise.allSettled([
        submitFamilyRelationshipUpdate(db, source, staffA, APR_U_B, "mother"),
        submitFamilyRelationshipUpdate(db, source, staffA, APR_U_B, "spouse"),
      ]);

      const successes = approvalResults.filter(
        (result) => result.status === "fulfilled" && result.value.mode === "approval",
      );
      const failures = approvalResults.filter((result) => result.status === "rejected");

      assert.equal(successes.length, 1);
      assert.equal(failures.length, 1);
      assert.ok(
        failures[0]?.status === "rejected" &&
          failures[0].reason instanceof FamilyLinkError &&
          failures[0].reason.errorCode === FAMILY_ERROR_CODES.DUPLICATE_PENDING,
      );

      const pendingRows = await db
        .select()
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.status, "pending"),
            sql`${schema.approvals.requestType} IN ('update_family_relationship', 'unlink_family_customer')`,
            or(
              and(
                eq(schema.approvals.customerId, APR_U_A),
                sql`json_extract(${schema.approvals.relatedCustomerIds}, '$[0]') = ${APR_U_B}`,
              ),
              and(
                eq(schema.approvals.customerId, APR_U_B),
                sql`json_extract(${schema.approvals.relatedCustomerIds}, '$[0]') = ${APR_U_A}`,
              ),
            ),
          ),
        );
      assert.equal(pendingRows.length, 1);
    });
  });

  describe("other", () => {
    beforeEach(async () => {
      await resetB6HouseholdState(db);
    });

    it("generic endpoint blocks update_family_relationship via validateApprovalRequestInput", () => {
      const result = validateApprovalRequestInput({
        requestType: "update_family_relationship",
        reason: "B6 test",
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        const err = result.fieldErrors.find((field) => field.field === "requestType");
        assert.equal(err?.code, "FAMILY_MANAGEMENT_USE_DEDICATED_ENDPOINT");
      }
    });

    it("generic endpoint blocks unlink_family_customer via validateApprovalRequestInput", () => {
      const result = validateApprovalRequestInput({
        requestType: "unlink_family_customer",
        reason: "B6 test",
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        const err = result.fieldErrors.find((field) => field.field === "requestType");
        assert.equal(err?.code, "FAMILY_MANAGEMENT_USE_DEDICATED_ENDPOINT");
      }
    });

    it("staff serialization strips payload/relatedCustomerIds for B6 types", async () => {
      await linkInHousehold(db, SER_A, SER_B, "father");
      const source = await getCustomer(db, SER_A);

      const updatePending = await submitFamilyRelationshipUpdate(
        db,
        source,
        staffA,
        SER_B,
        "mother",
      );
      assert.equal(updatePending.mode, "approval");
      if (updatePending.mode !== "approval") return;

      const updateApproval = await getApprovalById(db, updatePending.approvalId);
      assert.ok(updateApproval);
      const updateItem = approvalListItemFromApproval(
        updateApproval,
        source.customerName,
      );

      const updateSerialized = sanitizeApprovalListItemForUser(staffA, updateItem);
      assert.equal(updateSerialized.relatedCustomerIds, null);
      assert.equal(updateSerialized.payload, null);
      assert.doesNotMatch(JSON.stringify(updateSerialized), new RegExp(SER_B));

      await resetB6HouseholdState(db);
      await linkInHousehold(db, SER_A, SER_B, "father");

      const unlinkPending = await submitFamilyUnlink(db, source, staffA, SER_B);
      assert.equal(unlinkPending.mode, "approval");
      if (unlinkPending.mode !== "approval") return;

      const unlinkApproval = await getApprovalById(db, unlinkPending.approvalId);
      assert.ok(unlinkApproval);
      const unlinkItem = approvalListItemFromApproval(
        unlinkApproval,
        source.customerName,
      );
      const unlinkSerialized = sanitizeApprovalListItemForUser(staffA, unlinkItem);
      assert.equal(unlinkSerialized.relatedCustomerIds, null);
      assert.equal(unlinkSerialized.payload, null);

      const adminDetails = await loadFamilyManagementAdminDetails(db, [
        updateItem,
        unlinkItem,
      ]);
      assert.ok(adminDetails.get(updateItem.id));
      assert.ok(adminDetails.get(unlinkItem.id));
    });

    it("direct unlink rollback: duplicate PK insert leaves household tables and customers unchanged", async () => {
      await linkInHousehold(db, RBK_DIR_A, RBK_DIR_B, "father");
      const householdBefore = await countHouseholdTables(db);
      const customersBefore = (
        await db
          .select()
          .from(schema.customers)
          .where(inArray(schema.customers.id, [RBK_DIR_A, RBK_DIR_B]))
      ).length;
      const membershipId = (
        await db
          .select({ id: schema.customerHouseholdMembers.id })
          .from(schema.customerHouseholdMembers)
          .where(eq(schema.customerHouseholdMembers.customerId, RBK_DIR_B))
          .limit(1)
      )[0]?.id;
      assert.ok(membershipId);

      await assert.rejects(
        () =>
          executeFamilyUnlink(db, {
            sourceId: RBK_DIR_A,
            targetId: RBK_DIR_B,
            actor: staffA,
            testAppendStatements: ({ db: batchDb }) => [
              batchDb.insert(schema.customerHouseholdMembers).values({
                id: membershipId,
                householdId: crypto.randomUUID(),
                customerId: RBK_DIR_B,
                joinedAt: NOW,
                joinedBy: SEED_IDS.staffA,
              }),
            ],
          }),
      );

      const householdAfter = await countHouseholdTables(db);
      assert.deepEqual(householdAfter, householdBefore);

      const customersAfter = (
        await db
          .select()
          .from(schema.customers)
          .where(inArray(schema.customers.id, [RBK_DIR_A, RBK_DIR_B]))
      ).length;
      assert.equal(customersAfter, customersBefore);
    });

    it("approved unlink rollback: batch failure keeps approval pending", async () => {
      await linkInHousehold(db, RBK_APR_A, RBK_APR_B, "father");
      const source = await getCustomer(db, RBK_APR_A);

      const pending = await submitFamilyUnlink(db, source, staffA, RBK_APR_B);
      assert.equal(pending.mode, "approval");
      if (pending.mode !== "approval") return;

      const approval = await getApprovalById(db, pending.approvalId);
      assert.ok(approval);

      const membershipId = (
        await db
          .select({ id: schema.customerHouseholdMembers.id })
          .from(schema.customerHouseholdMembers)
          .where(eq(schema.customerHouseholdMembers.customerId, RBK_APR_B))
          .limit(1)
      )[0]?.id;
      assert.ok(membershipId);

      await assert.rejects(
        () =>
          executeFamilyUnlink(db, {
            sourceId: RBK_APR_A,
            targetId: RBK_APR_B,
            actor: admin,
            approvalCas: {
              approvalId: approval.id,
              reviewerId: admin.id,
              adminComment: null,
              now: new Date().toISOString(),
            },
            snapshot: JSON.parse(approval.payload ?? "{}"),
            testAppendStatements: ({ db: batchDb }) => [
              batchDb.insert(schema.customerHouseholdMembers).values({
                id: membershipId,
                householdId: crypto.randomUUID(),
                customerId: RBK_APR_B,
                joinedAt: NOW,
                joinedBy: SEED_IDS.admin,
              }),
            ],
          }),
      );

      const approvalAfter = await getApprovalById(db, pending.approvalId);
      assert.equal(approvalAfter?.status, "pending");

      const activeMember = await db
        .select()
        .from(schema.customerHouseholdMembers)
        .where(
          and(
            eq(schema.customerHouseholdMembers.customerId, RBK_APR_B),
            isNull(schema.customerHouseholdMembers.leftAt),
          ),
        );
      assert.equal(activeMember.length, 1);
    });
  });
});
