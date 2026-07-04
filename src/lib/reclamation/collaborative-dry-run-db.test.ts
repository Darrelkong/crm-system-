import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { AuthError } from "@/lib/permissions/auth";
import { getCollaborativeDissolutionDryRunForAdmin } from "@/lib/reclamation/collaborative-dry-run-api";
import { getCollaborativeDissolutionDryRun } from "@/lib/reclamation/collaborative-dry-run";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const FIXED_NOW = new Date("2026-06-29T12:00:00.000Z");

const TEST_SOLO = "cccccccc-cccc-cccc-cccc-cccccccccc01";
const TEST_COLLAB_60 = "cccccccc-cccc-cccc-cccc-cccccccccc02";
const TEST_COLLAB_90 = "cccccccc-cccc-cccc-cccc-cccccccccc03";
const TEST_COLLAB_CREATED_ANCHOR = "cccccccc-cccc-cccc-cccc-cccccccccc04";
const TEST_COLLAB_RECENT_FOLLOWUP = "cccccccc-cccc-cccc-cccc-cccccccccc05";
const TEST_COLLAB_PINNED = "cccccccc-cccc-cccc-cccc-cccccccccc06";
const TEST_COLLAB_CLOSED_WON = "cccccccc-cccc-cccc-cccc-cccccccccc07";
const TEST_COLLAB_ON_HOLD = "cccccccc-cccc-cccc-cccc-cccccccccc08";
const TEST_COLLAB_CONVERTED = "cccccccc-cccc-cccc-cccc-cccccccccc09";

const ALL_TEST_IDS = [
  TEST_SOLO,
  TEST_COLLAB_60,
  TEST_COLLAB_90,
  TEST_COLLAB_CREATED_ANCHOR,
  TEST_COLLAB_RECENT_FOLLOWUP,
  TEST_COLLAB_PINNED,
  TEST_COLLAB_CLOSED_WON,
  TEST_COLLAB_ON_HOLD,
  TEST_COLLAB_CONVERTED,
];

const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staff = { id: SEED_IDS.staffA, role: "staff" } as User;

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

function daysAgoIso(days: number, now: Date): string {
  return new Date(now.getTime() - days * MS_PER_DAY).toISOString();
}

function makeCustomer(
  overrides: Partial<Customer> & Pick<Customer, "id" | "customerName">,
): Customer {
  const createdAt = overrides.createdAt ?? daysAgoIso(120, FIXED_NOW);
  return {
    customerCode: overrides.customerCode ?? null,
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800001234",
    wechatId: "wx-secret",
    email: "secret@example.com",
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    notes: "sensitive note content",
    salesStage: "negotiation",
    status: "active",
    ownerId: SEED_IDS.staffA,
    releaserUserId: null,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    isPinned: 0,
    pinnedAt: null,
    lastFollowUpAt: null,
    lastValidFollowUpAt: daysAgoIso(95, FIXED_NOW),
    nextFollowUpAt: null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    createdBy: SEED_IDS.staffA,
    updatedBy: SEED_IDS.staffA,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  } as Customer;
}

async function upsertCustomer(customer: Customer) {
  const existing = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(eq(schema.customers.id, customer.id))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(schema.customers)
      .set(customer)
      .where(eq(schema.customers.id, customer.id));
  } else {
    await db.insert(schema.customers).values(customer);
  }
}

async function upsertCollaborator(customerId: string, userId: string) {
  const id = `ca_c3_${customerId}_${userId}`;
  const now = FIXED_NOW.toISOString();
  const existing = await db
    .select({ id: schema.customerAssignees.id })
    .from(schema.customerAssignees)
    .where(eq(schema.customerAssignees.id, id))
    .limit(1);

  const row = {
    id,
    customerId,
    userId,
    role: "collaborator" as const,
    assignedBy: SEED_IDS.admin,
    assignedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  if (existing.length > 0) {
    await db
      .update(schema.customerAssignees)
      .set(row)
      .where(eq(schema.customerAssignees.id, id));
  } else {
    await db.insert(schema.customerAssignees).values(row);
  }
}

async function deleteTestData() {
  await db
    .delete(schema.customerAssignees)
    .where(inArray(schema.customerAssignees.customerId, ALL_TEST_IDS));
  await db
    .delete(schema.customers)
    .where(inArray(schema.customers.id, ALL_TEST_IDS));
}

async function seedDryRunFixtures() {
  await deleteTestData();

  await upsertCustomer(
    makeCustomer({
      id: TEST_SOLO,
      customerName: "C3 Solo Customer",
      lastValidFollowUpAt: daysAgoIso(100, FIXED_NOW),
    }),
  );

  await upsertCustomer(
    makeCustomer({
      id: TEST_COLLAB_60,
      customerName: "C3 Collab 60d",
      lastValidFollowUpAt: daysAgoIso(60, FIXED_NOW),
    }),
  );
  await upsertCollaborator(TEST_COLLAB_60, SEED_IDS.staffB);

  await upsertCustomer(
    makeCustomer({
      id: TEST_COLLAB_90,
      customerName: "C3 Collab 90d",
      lastValidFollowUpAt: daysAgoIso(90, FIXED_NOW),
    }),
  );
  await upsertCollaborator(TEST_COLLAB_90, SEED_IDS.staffB);
  await upsertCollaborator(TEST_COLLAB_90, SEED_IDS.admin);

  await upsertCustomer(
    makeCustomer({
      id: TEST_COLLAB_CREATED_ANCHOR,
      customerName: "C3 Collab Created Anchor",
      createdAt: daysAgoIso(95, FIXED_NOW),
      updatedAt: daysAgoIso(95, FIXED_NOW),
      lastValidFollowUpAt: null,
    }),
  );
  await upsertCollaborator(TEST_COLLAB_CREATED_ANCHOR, SEED_IDS.staffB);

  await upsertCustomer(
    makeCustomer({
      id: TEST_COLLAB_RECENT_FOLLOWUP,
      customerName: "C3 Collab Recent Followup",
      createdAt: daysAgoIso(120, FIXED_NOW),
      updatedAt: daysAgoIso(120, FIXED_NOW),
      lastValidFollowUpAt: daysAgoIso(10, FIXED_NOW),
    }),
  );
  await upsertCollaborator(TEST_COLLAB_RECENT_FOLLOWUP, SEED_IDS.staffB);

  await upsertCustomer(
    makeCustomer({
      id: TEST_COLLAB_PINNED,
      customerName: "C3 Collab Pinned",
      isPinned: 1,
      pinnedAt: daysAgoIso(1, FIXED_NOW),
      lastValidFollowUpAt: daysAgoIso(100, FIXED_NOW),
    }),
  );
  await upsertCollaborator(TEST_COLLAB_PINNED, SEED_IDS.staffB);

  await upsertCustomer(
    makeCustomer({
      id: TEST_COLLAB_CLOSED_WON,
      customerName: "C3 Collab Closed Won",
      salesStage: "closed_won",
      lastValidFollowUpAt: daysAgoIso(100, FIXED_NOW),
    }),
  );
  await upsertCollaborator(TEST_COLLAB_CLOSED_WON, SEED_IDS.staffB);

  await upsertCustomer(
    makeCustomer({
      id: TEST_COLLAB_ON_HOLD,
      customerName: "C3 Collab On Hold",
      salesStage: "on_hold",
      lastValidFollowUpAt: daysAgoIso(100, FIXED_NOW),
    }),
  );
  await upsertCollaborator(TEST_COLLAB_ON_HOLD, SEED_IDS.staffB);

  await upsertCustomer(
    makeCustomer({
      id: TEST_COLLAB_CONVERTED,
      customerName: "C3 Collab Converted",
      salesStage: "converted",
      lastValidFollowUpAt: daysAgoIso(100, FIXED_NOW),
    }),
  );
  await upsertCollaborator(TEST_COLLAB_CONVERTED, SEED_IDS.staffB);
}

async function snapshotCustomer(customerId: string) {
  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1);
  const assignees = await db
    .select()
    .from(schema.customerAssignees)
    .where(eq(schema.customerAssignees.customerId, customerId));
  return { customer, assignees };
}

describe("collaborative dissolution dry-run (DB)", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
    await seedDryRunFixtures();
  });

  after(async () => {
    await deleteTestData();
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  describe("getCollaborativeDissolutionDryRun", () => {
    it("returns enabled=false by default", async () => {
      const result = await getCollaborativeDissolutionDryRun(db, {
        now: FIXED_NOW,
      });
      assert.equal(result.enabled, false);
      assert.equal(result.thresholdDays, 90);
    });

    it("excludes customers without collaborators", async () => {
    const result = await getCollaborativeDissolutionDryRun(db, {
      now: FIXED_NOW,
    });
    assert.equal(
      result.candidates.some((candidate) => candidate.customerId === TEST_SOLO),
      false,
    );
  });

  it("excludes collaborative customers below 90-day threshold", async () => {
    const result = await getCollaborativeDissolutionDryRun(db, {
      now: FIXED_NOW,
    });
    assert.equal(
      result.candidates.some(
        (candidate) => candidate.customerId === TEST_COLLAB_60,
      ),
      false,
    );
  });

  it("includes collaborative customers at or above 90-day threshold", async () => {
    const result = await getCollaborativeDissolutionDryRun(db, {
      now: FIXED_NOW,
    });
    const candidate = result.candidates.find(
      (row) => row.customerId === TEST_COLLAB_90,
    );
    assert.ok(candidate);
    assert.equal(candidate.daysWithoutValidFollowUp, 90);
    assert.equal(candidate.collaboratorCount, 2);
  });

  it("uses lastValidFollowUpAt when newer than createdAt", async () => {
    const result = await getCollaborativeDissolutionDryRun(db, {
      now: FIXED_NOW,
    });
    assert.equal(
      result.candidates.some(
        (candidate) => candidate.customerId === TEST_COLLAB_RECENT_FOLLOWUP,
      ),
      false,
    );
  });

  it("uses createdAt when lastValidFollowUpAt is null", async () => {
    const result = await getCollaborativeDissolutionDryRun(db, {
      now: FIXED_NOW,
    });
    const candidate = result.candidates.find(
      (row) => row.customerId === TEST_COLLAB_CREATED_ANCHOR,
    );
    assert.ok(candidate);
    assert.equal(candidate.lastValidFollowUpAt, null);
    assert.equal(candidate.daysWithoutValidFollowUp >= 90, true);
  });

  it("excludes pinned customers", async () => {
    const result = await getCollaborativeDissolutionDryRun(db, {
      now: FIXED_NOW,
    });
    assert.equal(
      result.candidates.some(
        (candidate) => candidate.customerId === TEST_COLLAB_PINNED,
      ),
      false,
    );
  });

  it("excludes closed_won, converted, and on_hold customers", async () => {
    const result = await getCollaborativeDissolutionDryRun(db, {
      now: FIXED_NOW,
    });
    const excludedIds = [
      TEST_COLLAB_CLOSED_WON,
      TEST_COLLAB_CONVERTED,
      TEST_COLLAB_ON_HOLD,
    ];
    for (const customerId of excludedIds) {
      assert.equal(
        result.candidates.some((candidate) => candidate.customerId === customerId),
        false,
      );
    }
  });

  it("does not return sensitive customer fields", async () => {
    const result = await getCollaborativeDissolutionDryRun(db, {
      now: FIXED_NOW,
    });
    for (const candidate of result.candidates) {
      assert.equal("phone" in candidate, false);
      assert.equal("email" in candidate, false);
      assert.equal("wechatId" in candidate, false);
      assert.equal("notes" in candidate, false);
    }
  });

  it("does not modify customer status, ownerId, or assignees", async () => {
    const before = await snapshotCustomer(TEST_COLLAB_90);
    await getCollaborativeDissolutionDryRun(db, { now: FIXED_NOW });
    const after = await snapshotCustomer(TEST_COLLAB_90);

    assert.deepEqual(after.customer?.status, before.customer?.status);
    assert.deepEqual(after.customer?.ownerId, before.customer?.ownerId);
    assert.equal(after.assignees.length, before.assignees.length);
  });
  });

  describe("getCollaborativeDissolutionDryRunForAdmin", () => {
    it("allows admin access and returns summary fields", async () => {
    const result = await getCollaborativeDissolutionDryRunForAdmin(admin, db, {
      now: FIXED_NOW,
    });
    assert.equal(result.enabled, false);
    assert.equal(result.thresholdDays, 90);
    assert.equal(typeof result.totalCandidates, "number");
    assert.equal(result.totalCandidates, result.candidates.length);
  });

  it("rejects staff access", async () => {
    await assert.rejects(
      () =>
        getCollaborativeDissolutionDryRunForAdmin(staff, db, {
          now: FIXED_NOW,
        }),
      (error: unknown) => {
        assert.ok(error instanceof AuthError);
        assert.equal(error.status, 403);
        return true;
      },
    );
  });

  it("does not expose sensitive fields in API payload", async () => {
    const result = await getCollaborativeDissolutionDryRunForAdmin(admin, db, {
      now: FIXED_NOW,
    });
    for (const candidate of result.candidates) {
      assert.equal("phone" in candidate, false);
      assert.equal("email" in candidate, false);
      assert.equal("wechatId" in candidate, false);
      assert.equal("notes" in candidate, false);
    }
  });
  });
});
