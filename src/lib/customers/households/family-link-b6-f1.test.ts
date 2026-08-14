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
} from "@/lib/approvals/service";
import { getApprovalById } from "@/lib/approvals/queries";
import {
  loadFamilyManagementAdminDetails,
  sanitizeApprovalListItemForUser,
} from "@/lib/approvals/family-link-serialization";
import type { ApprovalListItem } from "@/lib/approvals/queries";
import { validateApprovalRequestInput } from "@/lib/approvals/validation";
import {
  submitFamilyRelationshipUpdate,
  submitFamilyUnlink,
} from "./family-management-approval";
import { buildRelationshipSnapshot } from "./family-management-context";
import { executeRelationshipUpdate } from "./family-relationship-update";
import { executeFamilyUnlink } from "./family-unlink";
import { executeFamilyLink } from "./link-existing";
import { FAMILY_ERROR_CODES, FamilyLinkError } from "./errors";

const NOW = "2026-08-14T10:00:00.000Z";
const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;

const NC_A = "b6f1-nc-a";
const NC_B = "b6f1-nc-b";
const NC2_A = "b6f1-nc2-a";
const NC2_B = "b6f1-nc2-b";
const LEG_A = "b6f1-leg-a";
const LEG_B = "b6f1-leg-b";
const STALE_A = "b6f1-stale-a";
const STALE_B = "b6f1-stale-b";
const REV_CHILD_A = "b6f1-rev-child-a";
const REV_CHILD_B = "b6f1-rev-child-b";
const REV_PARENT_A = "b6f1-rev-parent-a";
const REV_PARENT_B = "b6f1-rev-parent-b";
const DIR_UPD_A = "b6f1-dir-upd-a";
const DIR_UPD_B = "b6f1-dir-upd-b";
const DIR_UPD_NONE_A = "b6f1-dir-none-a";
const DIR_UPD_NONE_B = "b6f1-dir-none-b";
const UNL3_A = "b6f1-unl3-a";
const UNL3_B = "b6f1-unl3-b";
const UNL3_C = "b6f1-unl3-c";
const UNL2_A = "b6f1-unl2-a";
const UNL2_B = "b6f1-unl2-b";
const UNLM_A = "b6f1-unlm-a";
const UNLM_B = "b6f1-unlm-b";
const UNLM_C = "b6f1-unlm-c";
const SER_A = "b6f1-ser-a";
const SER_B = "b6f1-ser-b";

const ALL_B6F1_IDS = [
  NC_A,
  NC_B,
  NC2_A,
  NC2_B,
  LEG_A,
  LEG_B,
  STALE_A,
  STALE_B,
  REV_CHILD_A,
  REV_CHILD_B,
  REV_PARENT_A,
  REV_PARENT_B,
  DIR_UPD_A,
  DIR_UPD_B,
  DIR_UPD_NONE_A,
  DIR_UPD_NONE_B,
  UNL3_A,
  UNL3_B,
  UNL3_C,
  UNL2_A,
  UNL2_B,
  UNLM_A,
  UNLM_B,
  UNLM_C,
  SER_A,
  SER_B,
] as const;

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function customerRow(
  id: string,
  ownerId: string,
  overrides: Partial<typeof schema.customers.$inferInsert> = {},
) {
  return {
    id,
    customerName: `B6F1 ${id}`,
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

async function cleanupB6F1Artifacts(db: TestDb) {
  for (const id of ALL_B6F1_IDS) {
    await deleteCustomerGraph(db, id);
  }

  const stray = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(sql`${schema.customers.id} LIKE 'b6f1-%'`);

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

async function resetB6F1HouseholdState(db: TestDb) {
  const b6f1Ids = (
    await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(sql`${schema.customers.id} LIKE 'b6f1-%'`)
  ).map((row) => row.id);

  if (b6f1Ids.length === 0) return;

  await db
    .delete(schema.customerHouseholdRelationships)
    .where(
      or(
        inArray(schema.customerHouseholdRelationships.fromCustomerId, b6f1Ids),
        inArray(schema.customerHouseholdRelationships.toCustomerId, b6f1Ids),
      ),
    );
  await db
    .delete(schema.customerHouseholdMembers)
    .where(inArray(schema.customerHouseholdMembers.customerId, b6f1Ids));
  await db
    .delete(schema.customerHouseholds)
    .where(inArray(schema.customerHouseholds.createdFromCustomerId, b6f1Ids));
  await db.delete(schema.approvals).where(
    or(
      inArray(schema.approvals.customerId, b6f1Ids),
      sql`json_extract(${schema.approvals.relatedCustomerIds}, '$[0]') IN (${sql.join(
        b6f1Ids.map((id) => sql`${id}`),
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

async function insertLegacyRelationshipApproval(
  db: TestDb,
  params: {
    sourceId: string;
    targetId: string;
    requestedRelationshipType: string;
    snapshot: ReturnType<typeof buildRelationshipSnapshot> & {
      householdId: string;
    };
    requestedBy?: string;
  },
) {
  const approvalId = crypto.randomUUID();
  const payload = {
    ...params.snapshot,
    requestedRelationshipType: params.requestedRelationshipType,
    sourceId: params.sourceId,
    targetId: params.targetId,
  };

  await db.insert(schema.approvals).values({
    id: approvalId,
    requestType: "update_family_relationship",
    status: "pending",
    customerId: params.sourceId,
    requestedBy: params.requestedBy ?? SEED_IDS.staffA,
    targetUserId: null,
    relatedCustomerIds: JSON.stringify([params.targetId]),
    payload: JSON.stringify(payload),
    reason: "B6F1 legacy approval",
    adminComment: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  });

  return approvalId;
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

describe("family link B6-F1 management fixes", () => {
  let dispose: (() => Promise<void>) | undefined;
  let db: TestDb;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({ configPath: "./wrangler.jsonc" });
    dispose = proxy.dispose;
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);

    await cleanupB6F1Artifacts(db);

    await seedCustomers(db, [
      customerRow(NC_A, SEED_IDS.staffA),
      customerRow(NC_B, SEED_IDS.staffB),
      customerRow(NC2_A, SEED_IDS.staffA),
      customerRow(NC2_B, SEED_IDS.staffB),
      customerRow(LEG_A, SEED_IDS.staffA),
      customerRow(LEG_B, SEED_IDS.staffB),
      customerRow(STALE_A, SEED_IDS.staffA),
      customerRow(STALE_B, SEED_IDS.staffB),
      customerRow(REV_CHILD_A, SEED_IDS.staffA),
      customerRow(REV_CHILD_B, SEED_IDS.staffB),
      customerRow(REV_PARENT_A, SEED_IDS.staffA),
      customerRow(REV_PARENT_B, SEED_IDS.staffB),
      customerRow(DIR_UPD_A, SEED_IDS.staffA),
      customerRow(DIR_UPD_B, SEED_IDS.staffA),
      customerRow(DIR_UPD_NONE_A, SEED_IDS.staffA),
      customerRow(DIR_UPD_NONE_B, SEED_IDS.staffA),
      customerRow(UNL3_A, SEED_IDS.staffA),
      customerRow(UNL3_B, SEED_IDS.staffA),
      customerRow(UNL3_C, SEED_IDS.staffA),
      customerRow(UNL2_A, SEED_IDS.staffA),
      customerRow(UNL2_B, SEED_IDS.staffA),
      customerRow(UNLM_A, SEED_IDS.staffA),
      customerRow(UNLM_B, SEED_IDS.staffA),
      customerRow(UNLM_C, SEED_IDS.staffA),
      customerRow(SER_A, SEED_IDS.staffA),
      customerRow(SER_B, SEED_IDS.staffB),
    ]);
  });

  after(async () => {
    await cleanupB6F1Artifacts(db);
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  describe("no_change cross-owner (1-2)", () => {
    beforeEach(async () => {
      await resetB6F1HouseholdState(db);
    });

    it("1: cross-owner staff selects exact current direct relationship → direct no_change, no pending approval", async () => {
      await linkInHousehold(db, NC_A, NC_B, "father");
      const beforeCount = (await db.select().from(schema.approvals)).length;
      const source = await getCustomer(db, NC_A);

      const result = await submitFamilyRelationshipUpdate(
        db,
        source,
        staffA,
        NC_B,
        "father",
      );

      assert.equal(result.mode, "direct");
      if (result.mode === "direct") {
        assert.equal(result.kind, "no_change");
      }

      const afterCount = (await db.select().from(schema.approvals)).length;
      assert.equal(afterCount, beforeCount);

      const rels = await relationshipsForPair(db, NC_A, NC_B);
      assert.equal(rels.length, 1);
      assert.equal(rels[0]?.relationshipType, "father");
    });

    it("2: cross-owner staff with father already direct → no_change, not approval", async () => {
      await linkInHousehold(db, NC2_A, NC2_B, "father");
      const source = await getCustomer(db, NC2_A);

      const result = await submitFamilyRelationshipUpdate(
        db,
        source,
        staffA,
        NC2_B,
        "father",
      );

      assert.equal(result.mode, "direct");
      if (result.mode === "direct") {
        assert.equal(result.kind, "no_change");
      }

      const pending = await db
        .select()
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.status, "pending"),
            eq(schema.approvals.requestType, "update_family_relationship"),
            eq(schema.approvals.customerId, NC2_A),
          ),
        );
      assert.equal(pending.length, 0);
    });
  });

  describe("legacy approval no_change (3)", () => {
    beforeEach(async () => {
      await resetB6F1HouseholdState(db);
    });

    it("3: legacy pending approval with valid unchanged snapshot → approved, no mutation, not stuck pending", async () => {
      await linkInHousehold(db, LEG_A, LEG_B, "spouse");
      const householdId = await getHouseholdIdForCustomer(db, LEG_A);
      const rels = await relationshipsForPair(db, LEG_A, LEG_B);
      const rel = rels[0];
      assert.ok(rel);

      const snapshot = {
        householdId,
        expectedRelationshipState: "direct" as const,
        expectedRelationshipRowId: rel.id,
        expectedRelationshipType: "spouse" as const,
        expectedRelationshipUpdatedAt: rel.updatedAt,
      };

      const approvalId = await insertLegacyRelationshipApproval(db, {
        sourceId: LEG_A,
        targetId: LEG_B,
        requestedRelationshipType: "spouse",
        snapshot,
      });

      await approveApprovalRequest(approvalId, admin);

      const approval = await getApprovalById(db, approvalId);
      assert.equal(approval?.status, "approved");

      const relsAfter = await relationshipsForPair(db, LEG_A, LEG_B);
      assert.equal(relsAfter.length, 1);
      assert.equal(relsAfter[0]?.relationshipType, "spouse");
      assert.equal(relsAfter[0]?.updatedAt, rel.updatedAt);
    });
  });

  describe("approval stale (4)", () => {
    beforeEach(async () => {
      await resetB6F1HouseholdState(db);
    });

    it("4: pending approval requests mother, actor changes to mother before approve → 409 stale, stays pending", async () => {
      await linkInHousehold(db, STALE_A, STALE_B, "father");
      const source = await getCustomer(db, STALE_A);

      const pending = await submitFamilyRelationshipUpdate(
        db,
        source,
        staffA,
        STALE_B,
        "mother",
      );
      assert.equal(pending.mode, "approval");
      if (pending.mode !== "approval") return;

      await executeRelationshipUpdate(db, {
        sourceId: STALE_A,
        targetId: STALE_B,
        relationshipType: "mother",
        actor: admin,
      });

      await assert.rejects(
        () => approveApprovalRequest(pending.approvalId, admin),
        (error: unknown) =>
          error instanceof ApprovalError &&
          error.code === FAMILY_ERROR_CODES.APPROVAL_STALE,
      );

      const approval = await getApprovalById(db, pending.approvalId);
      assert.equal(approval?.status, "pending");

      const rels = await relationshipsForPair(db, STALE_A, STALE_B);
      assert.equal(rels[0]?.relationshipType, "mother");
    });
  });

  describe("admin detail perspective (5-6)", () => {
    beforeEach(async () => {
      await resetB6F1HouseholdState(db);
    });

    it("5: reverse stored B→A father → admin detail currentRelationship is child", async () => {
      await linkInHousehold(db, REV_CHILD_B, REV_CHILD_A, "father");
      const source = await getCustomer(db, REV_CHILD_A);

      const pending = await submitFamilyRelationshipUpdate(
        db,
        source,
        staffA,
        REV_CHILD_B,
        "mother",
      );
      assert.equal(pending.mode, "approval");
      if (pending.mode !== "approval") return;

      const approval = await getApprovalById(db, pending.approvalId);
      assert.ok(approval);
      const item = approvalListItemFromApproval(approval, source.customerName);
      const details = await loadFamilyManagementAdminDetails(db, [item]);
      const detail = details.get(item.id);

      assert.ok(detail);
      assert.equal(detail.currentRelationship, "child");
      assert.equal(detail.requestedRelationship, "mother");
    });

    it("6: reverse stored B→A son → admin detail currentRelationship is parent", async () => {
      await linkInHousehold(db, REV_PARENT_B, REV_PARENT_A, "son");
      const source = await getCustomer(db, REV_PARENT_A);

      const pending = await submitFamilyRelationshipUpdate(
        db,
        source,
        staffA,
        REV_PARENT_B,
        "mother",
      );
      assert.equal(pending.mode, "approval");
      if (pending.mode !== "approval") return;

      const approval = await getApprovalById(db, pending.approvalId);
      assert.ok(approval);
      const item = approvalListItemFromApproval(approval, source.customerName);
      const details = await loadFamilyManagementAdminDetails(db, [item]);
      const detail = details.get(item.id);

      assert.ok(detail);
      assert.equal(detail.currentRelationship, "parent");
      assert.equal(detail.requestedRelationship, "mother");
    });
  });

  describe("direct update guards (7-9)", () => {
    beforeEach(async () => {
      await resetB6F1HouseholdState(db);
    });

    it("7: testAfterContextLoad bumps relationship updated_at → 409, no overwrite", async () => {
      await linkInHousehold(db, DIR_UPD_A, DIR_UPD_B, "father");
      const relsBefore = await relationshipsForPair(db, DIR_UPD_A, DIR_UPD_B);

      await assert.rejects(
        () =>
          executeRelationshipUpdate(db, {
            sourceId: DIR_UPD_A,
            targetId: DIR_UPD_B,
            relationshipType: "mother",
            actor: staffA,
            testAfterContextLoad: async ({ db: testDb, context }) => {
              const row = context.directRelationship;
              assert.ok(row);
              await testDb
                .update(schema.customerHouseholdRelationships)
                .set({ updatedAt: "2026-08-14T11:00:00.000Z" })
                .where(eq(schema.customerHouseholdRelationships.id, row.id));
            },
          }),
        (error: unknown) =>
          error instanceof FamilyLinkError &&
          error.errorCode === FAMILY_ERROR_CODES.APPROVAL_STALE,
      );

      const relsAfter = await relationshipsForPair(db, DIR_UPD_A, DIR_UPD_B);
      assert.equal(relsAfter[0]?.relationshipType, relsBefore[0]?.relationshipType);
      assert.equal(relsAfter[0]?.relationshipType, "father");
    });

    it("8: testAfterContextLoad sets target membership left_at → 409, no insert", async () => {
      await linkInHousehold(db, DIR_UPD_A, DIR_UPD_B, "father");
      const relsBefore = await relationshipsForPair(db, DIR_UPD_A, DIR_UPD_B);

      await assert.rejects(
        () =>
          executeRelationshipUpdate(db, {
            sourceId: DIR_UPD_A,
            targetId: DIR_UPD_B,
            relationshipType: "mother",
            actor: staffA,
            testAfterContextLoad: async ({ db: testDb, context }) => {
              await testDb
                .update(schema.customerHouseholdMembers)
                .set({ leftAt: "2026-08-14T11:00:00.000Z" })
                .where(
                  eq(schema.customerHouseholdMembers.id, context.targetMembership.id),
                );
            },
          }),
        (error: unknown) =>
          error instanceof FamilyLinkError &&
          error.errorCode === FAMILY_ERROR_CODES.APPROVAL_STALE,
      );

      const relsAfter = await relationshipsForPair(db, DIR_UPD_A, DIR_UPD_B);
      assert.equal(relsAfter[0]?.relationshipType, relsBefore[0]?.relationshipType);
    });

    it("9: none→relationship, testAfterContextLoad removes target membership → guarded insert 409", async () => {
      await setupHouseholdWithoutRelationship(db, DIR_UPD_NONE_A, DIR_UPD_NONE_B);
      const relsBefore = await relationshipsForPair(db, DIR_UPD_NONE_A, DIR_UPD_NONE_B);
      assert.equal(relsBefore.length, 0);

      await assert.rejects(
        () =>
          executeRelationshipUpdate(db, {
            sourceId: DIR_UPD_NONE_A,
            targetId: DIR_UPD_NONE_B,
            relationshipType: "mother",
            actor: staffA,
            testAfterContextLoad: async ({ db: testDb, context }) => {
              await testDb
                .update(schema.customerHouseholdMembers)
                .set({ leftAt: "2026-08-14T11:00:00.000Z" })
                .where(
                  eq(schema.customerHouseholdMembers.id, context.targetMembership.id),
                );
            },
          }),
        (error: unknown) =>
          error instanceof FamilyLinkError &&
          error.errorCode === FAMILY_ERROR_CODES.APPROVAL_STALE,
      );

      const relsAfter = await relationshipsForPair(db, DIR_UPD_NONE_A, DIR_UPD_NONE_B);
      assert.equal(relsAfter.length, 0);
    });
  });

  describe("direct unlink guards and success (10-12)", () => {
    beforeEach(async () => {
      await resetB6F1HouseholdState(db);
    });

    it("10: three-member unlink, testAfterContextLoad removes C → 409, no partial unlink of B", async () => {
      await linkInHousehold(db, UNL3_A, UNL3_B, "father");
      const householdId = await getHouseholdIdForCustomer(db, UNL3_A);

      await db.insert(schema.customerHouseholdMembers).values({
        id: crypto.randomUUID(),
        householdId,
        customerId: UNL3_C,
        joinedAt: NOW,
        joinedBy: SEED_IDS.staffA,
      });
      await insertRelationshipRow(db, householdId, UNL3_A, UNL3_C, "mother");

      const bMembershipBefore = (
        await db
          .select()
          .from(schema.customerHouseholdMembers)
          .where(eq(schema.customerHouseholdMembers.customerId, UNL3_B))
      )[0];
      assert.ok(bMembershipBefore);
      assert.equal(bMembershipBefore.leftAt, null);

      await assert.rejects(
        () =>
          executeFamilyUnlink(db, {
            sourceId: UNL3_A,
            targetId: UNL3_B,
            actor: staffA,
            testAfterContextLoad: async ({ db: testDb }) => {
              await testDb
                .update(schema.customerHouseholdMembers)
                .set({ leftAt: "2026-08-14T11:00:00.000Z" })
                .where(eq(schema.customerHouseholdMembers.customerId, UNL3_C));
            },
          }),
        (error: unknown) =>
          error instanceof FamilyLinkError &&
          error.errorCode === FAMILY_ERROR_CODES.INVALID_HOUSEHOLD_STATE,
      );

      const bMembershipAfter = (
        await db
          .select()
          .from(schema.customerHouseholdMembers)
          .where(eq(schema.customerHouseholdMembers.customerId, UNL3_B))
      )[0];
      assert.ok(bMembershipAfter);
      assert.equal(bMembershipAfter.leftAt, null);

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
    });

    it("11: two-member direct unlink still works", async () => {
      await linkInHousehold(db, UNL2_A, UNL2_B, "father");
      const householdId = await getHouseholdIdForCustomer(db, UNL2_A);
      const source = await getCustomer(db, UNL2_A);

      const result = await submitFamilyUnlink(db, source, staffA, UNL2_B);
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
    });

    it("12: multi-member direct unlink still works", async () => {
      await linkInHousehold(db, UNLM_A, UNLM_B, "father");
      const householdId = await getHouseholdIdForCustomer(db, UNLM_A);

      await db.insert(schema.customerHouseholdMembers).values({
        id: crypto.randomUUID(),
        householdId,
        customerId: UNLM_C,
        joinedAt: NOW,
        joinedBy: SEED_IDS.staffA,
      });
      await insertRelationshipRow(db, householdId, UNLM_A, UNLM_C, "mother");

      const source = await getCustomer(db, UNLM_A);
      const result = await submitFamilyUnlink(db, source, staffA, UNLM_B);
      assert.equal(result.mode, "direct");
      if (result.mode === "direct") {
        assert.equal(result.householdAction, "member_removed");
      }

      const bMembership = await db
        .select()
        .from(schema.customerHouseholdMembers)
        .where(eq(schema.customerHouseholdMembers.customerId, UNLM_B));
      assert.ok(bMembership[0]?.leftAt);

      const acRels = await relationshipsForPair(db, UNLM_A, UNLM_C);
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
  });

  describe("other (13-14)", () => {
    beforeEach(async () => {
      await resetB6F1HouseholdState(db);
    });

    it("13: generic endpoint blocks update_family_relationship", () => {
      const result = validateApprovalRequestInput({
        requestType: "update_family_relationship",
        reason: "B6F1 test",
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        const err = result.fieldErrors.find((field) => field.field === "requestType");
        assert.equal(err?.code, "FAMILY_MANAGEMENT_USE_DEDICATED_ENDPOINT");
      }
    });

    it("13b: generic endpoint blocks unlink_family_customer", () => {
      const result = validateApprovalRequestInput({
        requestType: "unlink_family_customer",
        reason: "B6F1 test",
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        const err = result.fieldErrors.find((field) => field.field === "requestType");
        assert.equal(err?.code, "FAMILY_MANAGEMENT_USE_DEDICATED_ENDPOINT");
      }
    });

    it("14: staff serialization strips payload/relatedCustomerIds for B6 types", async () => {
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

      await resetB6F1HouseholdState(db);
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
  });
});
