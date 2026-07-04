import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { getPendingApprovalCountForUser } from "./queries";

const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;

const TEST_APPROVAL_A1 = "test-pending-count-a1";
const TEST_APPROVAL_B1 = "test-pending-count-b1";
const TEST_APPROVAL_APPROVED = "test-pending-count-approved";
const TEST_APPROVAL_REJECTED = "test-pending-count-rejected";

const ALL_TEST_IDS = [
  TEST_APPROVAL_A1,
  TEST_APPROVAL_B1,
  TEST_APPROVAL_APPROVED,
  TEST_APPROVAL_REJECTED,
];

function makeApprovalRow(
  id: string,
  requestedBy: string,
  status: "pending" | "approved" | "rejected",
) {
  const now = new Date().toISOString();
  return {
    id,
    requestType: "update_customer_assignees" as const,
    status,
    customerId: SEED_IDS.customerStaffA,
    requestedBy,
    targetUserId: null,
    relatedCustomerIds: null,
    payload: null,
    reason: "test reason",
    adminComment: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("getPendingApprovalCountForUser", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let dispose: (() => Promise<void>) | undefined;

  // Baselines measured before inserting any test rows.
  let baselineAdmin = 0;
  let baselineStaffA = 0;
  let baselineStaffB = 0;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;

    // Clean up any leftover rows from previous runs before measuring baseline.
    for (const id of ALL_TEST_IDS) {
      await db.delete(schema.approvals).where(eq(schema.approvals.id, id));
    }

    // Record baselines against existing seed data.
    baselineAdmin = await getPendingApprovalCountForUser(db, admin);
    baselineStaffA = await getPendingApprovalCountForUser(db, staffA);
    baselineStaffB = await getPendingApprovalCountForUser(db, staffB);

    // Insert test rows:
    //   A1 = staffA pending
    //   B1 = staffB pending
    //   APPROVED = staffA approved  (should not count)
    //   REJECTED  = staffA rejected (should not count)
    await db.insert(schema.approvals).values(makeApprovalRow(TEST_APPROVAL_A1, SEED_IDS.staffA, "pending"));
    await db.insert(schema.approvals).values(makeApprovalRow(TEST_APPROVAL_B1, SEED_IDS.staffB, "pending"));
    await db.insert(schema.approvals).values(makeApprovalRow(TEST_APPROVAL_APPROVED, SEED_IDS.staffA, "approved"));
    await db.insert(schema.approvals).values(makeApprovalRow(TEST_APPROVAL_REJECTED, SEED_IDS.staffA, "rejected"));
  });

  after(async () => {
    for (const id of ALL_TEST_IDS) {
      await db.delete(schema.approvals).where(eq(schema.approvals.id, id));
    }
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("staff user with no submitted approvals returns 0", async () => {
    // Use a user ID that does not exist in the DB.
    const noApprovalStaff = { id: "00000000-0000-0000-0000-000000000099", role: "staff" } as User;
    const count = await getPendingApprovalCountForUser(db, noApprovalStaff);
    assert.equal(count, 0);
  });

  it("admin sees all pending approvals (baseline + 2 test pending rows)", async () => {
    const count = await getPendingApprovalCountForUser(db, admin);
    assert.equal(count, baselineAdmin + 2, "A1 and B1 should both be counted");
  });

  it("staff sees only their own pending approvals", async () => {
    const countA = await getPendingApprovalCountForUser(db, staffA);
    assert.equal(countA, baselineStaffA + 1, "staffA should see only A1");
  });

  it("staff does not see other staff pending approvals", async () => {
    const countA = await getPendingApprovalCountForUser(db, staffA);
    const countB = await getPendingApprovalCountForUser(db, staffB);
    assert.equal(countA, baselineStaffA + 1, "staffA should only see A1");
    assert.equal(countB, baselineStaffB + 1, "staffB should only see B1");
  });

  it("approved and rejected approvals are not counted", async () => {
    // staffA has A1 (pending), APPROVED, REJECTED — only pending A1 counts.
    const countA = await getPendingApprovalCountForUser(db, staffA);
    assert.equal(countA, baselineStaffA + 1, "approved/rejected must be excluded for staff");

    // Admin: only 2 pending (A1, B1) despite APPROVED and REJECTED rows.
    const countAdmin = await getPendingApprovalCountForUser(db, admin);
    assert.equal(countAdmin, baselineAdmin + 2, "approved/rejected must be excluded for admin");
  });
});
