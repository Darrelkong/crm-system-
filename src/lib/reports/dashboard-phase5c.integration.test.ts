import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getAdminTeamExecutionOverview, sortTeamMembersStable } from "./admin-team-execution";
import {
  countAdminPrivateActiveCustomers,
  getDashboardStageDistribution,
} from "./dashboard-stage-distribution";
import { getDashboardSummary } from "./dashboard-summary";
import { listActiveStaffUsers } from "@/lib/users/queries";
import { getPendingActionCount } from "@/lib/notifications/queries";
import { listCustomersForUserPaginated } from "@/lib/customers/queries";
import type { User } from "../../../drizzle/schema/users";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

const staffA = {
  id: SEED_IDS.staffA,
  role: "staff",
  displayName: "Staff A",
} as User;

const staffB = {
  id: SEED_IDS.staffB,
  role: "staff",
  displayName: "Staff B",
} as User;

const admin = {
  id: SEED_IDS.admin,
  role: "admin",
  displayName: "Admin",
} as User;

const CUST = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb801";
const CUST_ADMIN = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb802";
const CUST_INACTIVE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb804";
const TEMP_INACTIVE_OWNER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb901";
const TEMP_DELETED_OWNER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb902";
const CUST_DELETED_OWNER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb805";
const MISSING_OWNER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb999";

async function cleanup(): Promise<void> {
  for (const id of [CUST, CUST_ADMIN, CUST_INACTIVE, CUST_DELETED_OWNER]) {
    await db.delete(schema.customers).where(eq(schema.customers.id, id));
  }
  for (const id of [TEMP_INACTIVE_OWNER, TEMP_DELETED_OWNER]) {
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
}

describe("dashboard phase 5C permissions DB", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
    await cleanup();
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("scopes staff stage distribution to owned active customers", async () => {
    await cleanup();
    const nowIso = new Date().toISOString();
    await db.insert(schema.customers).values({
      id: CUST,
      customerName: "[TEST] Stage dist",
      nameStatus: "confirmed",
      customerType: "individual",
      phoneCountryCode: "+86",
      phone: "13700000801",
      source: "referral",
      salesStage: "negotiation",
      ownerId: SEED_IDS.staffA,
      status: "active",
      createdBy: SEED_IDS.staffA,
      updatedBy: SEED_IDS.staffA,
      isPinned: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const staffDist = await getDashboardStageDistribution(db, staffA);
    assert.equal(staffDist.role, "staff");
    const staffNegotiation = staffDist.stages.find(
      (row) => row.key === "negotiation",
    );
    assert.ok((staffNegotiation?.count ?? 0) >= 1);

    const otherDist = await getDashboardStageDistribution(db, staffB);
    const otherNegotiation = otherDist.stages.find(
      (row) => row.key === "negotiation",
    );
    const before = otherNegotiation?.count ?? 0;

    await db
      .update(schema.customers)
      .set({ ownerId: SEED_IDS.staffB, updatedAt: nowIso })
      .where(eq(schema.customers.id, CUST));

    const staffAfterTransfer = await getDashboardStageDistribution(db, staffA);
    const staffNegotiationAfter = staffAfterTransfer.stages.find(
      (row) => row.key === "negotiation",
    );
    assert.ok((staffNegotiationAfter?.count ?? 0) < (staffNegotiation?.count ?? 1));

    const staffBDist = await getDashboardStageDistribution(db, staffB);
    const staffBNegotiation = staffBDist.stages.find(
      (row) => row.key === "negotiation",
    );
    assert.ok((staffBNegotiation?.count ?? 0) > before);
  });

  it("rejects staff access to admin team execution overview", async () => {
    await assert.rejects(
      () => getAdminTeamExecutionOverview(db, staffA),
      /Admin access required/,
    );
  });

  it("includes admin-owned customers in admin stage distribution total", async () => {
    await cleanup();
    const nowIso = new Date().toISOString();
    await db.insert(schema.customers).values({
      id: CUST_ADMIN,
      customerName: "[TEST] Admin owned stage",
      nameStatus: "confirmed",
      customerType: "individual",
      phoneCountryCode: "+86",
      phone: "13700000802",
      source: "referral",
      salesStage: "proposal",
      ownerId: SEED_IDS.admin,
      status: "active",
      createdBy: SEED_IDS.admin,
      updatedBy: SEED_IDS.admin,
      isPinned: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const adminDist = await getDashboardStageDistribution(db, admin);
    const proposal = adminDist.stages.find((row) => row.key === "proposal");
    assert.ok((proposal?.count ?? 0) >= 1);
    const privateTotal = await countAdminPrivateActiveCustomers(db);
    assert.equal(adminDist.totalCustomers, privateTotal);

    const staffDist = await getDashboardStageDistribution(db, staffA);
    const staffProposal = staffDist.stages.find((row) => row.key === "proposal");
    const staffProposalBefore = staffProposal?.count ?? 0;

    const adminOwnedInStaffList = staffDist.totalCustomers;
    assert.ok(adminDist.totalCustomers >= adminOwnedInStaffList);
    assert.equal(staffProposalBefore, staffProposal?.count ?? 0);
  });

  it("excludes missing, inactive, and soft-deleted owners from admin stage distribution", async () => {
    await cleanup();
    const baseline = await getDashboardStageDistribution(db, admin);
    const baselineQualification =
      baseline.stages.find((row) => row.key === "qualification")?.count ?? 0;
    const nowIso = new Date().toISOString();

    await db.insert(schema.users).values([
      {
        id: TEMP_INACTIVE_OWNER,
        email: "inactive-stage-owner@crm.local",
        displayName: "Inactive Stage Owner",
        passwordHash: "x",
        role: "staff",
        isActive: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: TEMP_DELETED_OWNER,
        email: "deleted-stage-owner@crm.local",
        displayName: "Deleted Stage Owner",
        passwordHash: "x",
        role: "staff",
        isActive: 1,
        deletedAt: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ]);

    await db.insert(schema.customers).values([
      {
        id: CUST_INACTIVE,
        customerName: "[TEST] Inactive owner stage",
        nameStatus: "confirmed",
        customerType: "individual",
        phoneCountryCode: "+86",
        phone: "13700000804",
        source: "referral",
        salesStage: "qualification",
        ownerId: TEMP_INACTIVE_OWNER,
        status: "active",
        createdBy: SEED_IDS.admin,
        updatedBy: SEED_IDS.admin,
        isPinned: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: CUST_DELETED_OWNER,
        customerName: "[TEST] Soft-deleted owner stage",
        nameStatus: "confirmed",
        customerType: "individual",
        phoneCountryCode: "+86",
        phone: "13700000805",
        source: "referral",
        salesStage: "qualification",
        ownerId: TEMP_DELETED_OWNER,
        status: "active",
        createdBy: SEED_IDS.admin,
        updatedBy: SEED_IDS.admin,
        isPinned: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ]);

    const after = await getDashboardStageDistribution(db, admin);
    const afterQualification =
      after.stages.find((row) => row.key === "qualification")?.count ?? 0;
    assert.equal(afterQualification, baselineQualification);
    assert.equal(after.totalCustomers, baseline.totalCustomers);

    const missingOwnerDrilldown = await listCustomersForUserPaginated(
      admin,
      { salesStage: "qualification", ownerId: MISSING_OWNER },
      1,
    );
    assert.equal(missingOwnerDrilldown.items.length, 0);
    assert.equal(missingOwnerDrilldown.pagination.total, 0);

    const inactiveDrilldown = await listCustomersForUserPaginated(
      admin,
      { salesStage: "qualification", ownerId: TEMP_INACTIVE_OWNER },
      1,
    );
    assert.equal(
      inactiveDrilldown.items.some((item) => item.id === CUST_INACTIVE),
      false,
    );

    const deletedDrilldown = await listCustomersForUserPaginated(
      admin,
      { salesStage: "qualification", ownerId: TEMP_DELETED_OWNER },
      1,
    );
    assert.equal(
      deletedDrilldown.items.some((item) => item.id === CUST_DELETED_OWNER),
      false,
    );

    const illegalOwner = await listCustomersForUserPaginated(
      admin,
      { ownerId: "not-a-uuid" },
      1,
    );
    assert.equal(illegalOwner.items.length, 0);
    assert.equal(illegalOwner.pagination.total, 0);

    const staffIllegal = await listCustomersForUserPaginated(
      staffA,
      { ownerId: SEED_IDS.staffB },
      1,
    );
    const staffOwn = await listCustomersForUserPaginated(staffA, {}, 1);
    assert.deepEqual(
      staffIllegal.items.map((item) => item.id).sort(),
      staffOwn.items.map((item) => item.id).sort(),
    );
  });

  it("aligns team current, overdue, and pending with staff dashboard metrics", async () => {
    const overview = await getAdminTeamExecutionOverview(db, admin);
    const staffMember = overview.members.find(
      (member) => member.userId === SEED_IDS.staffA,
    );
    assert.ok(staffMember);

    const summary = await getDashboardSummary(db, staffA);
    if (summary.role !== "staff") {
      throw new Error("expected staff summary");
    }

    assert.equal(staffMember.currentCustomers, summary.metrics.myCustomerCount);
    assert.equal(staffMember.overdueFollowUps, summary.metrics.overdueFollowUps);

    const pending = await getPendingActionCount(db, SEED_IDS.staffA);
    assert.equal(staffMember.pendingItems, pending);
  });

  it("returns admin team execution without rank fields", async () => {
    const overview = await getAdminTeamExecutionOverview(db, admin);
    assert.equal(overview.role, "admin");
    assert.equal(overview.defaultPeriodDays, 7);
    assert.ok(Array.isArray(overview.members));
    for (const member of overview.members) {
      assert.ok(member.userId);
      assert.ok(member.displayName);
      assert.equal(typeof member.currentCustomers, "number");
      assert.equal(typeof member.periodActivity[7].validFollowUps, "number");
      assert.equal(
        typeof member.periodActivity[30].stageProgressCustomers,
        "number",
      );
      assert.ok(member.customersHref.includes("ownerId="));
      assert.ok(member.reclamationHref.includes("reclamationRisk=team"));
      assert.equal(/rank|score/i.test(member.customersHref), false);
    }
    const staffDirectory = await listActiveStaffUsers();
    const expectedOrder = sortTeamMembersStable(staffDirectory).map(
      (member) => member.id,
    );
    const actualOrder = overview.members.map((member) => member.userId);
    assert.deepEqual(actualOrder, expectedOrder);
  });
});
