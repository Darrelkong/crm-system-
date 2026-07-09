import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  assertStaffCanViewCustomerDetailPage,
  formatCustomerForUser,
  getCustomerAccessLevel,
  isStaffUnclaimedPublicPoolCustomer,
  PermissionError,
} from "./customers";

const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const admin = { id: SEED_IDS.admin, role: "admin" } as User;

function publicPoolCustomer(overrides: Partial<Customer> = {}): Customer {
  const now = "2026-07-08T10:00:00.000Z";
  return {
    id: SEED_IDS.customerPublicPool,
    customerCode: null,
    customerName: "公共池測試客戶",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800138000",
    wechatId: "wx_pool",
    email: "pool@test.example",
    source: "referral",
    sourceRemark: "remark",
    requestedProjectName: "Project",
    notes: "notes",
    salesStage: "interested",
    ownerId: null,
    status: "public_pool",
    releaserUserId: SEED_IDS.staffB,
    poolEnteredAt: now,
    poolReason: "自動回收到公共池：超過 7 天无有效跟进",
    releasedBy: SEED_IDS.staffB,
    previousOwnerId: SEED_IDS.staffB,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    createdBy: SEED_IDS.admin,
    updatedBy: SEED_IDS.admin,
    lastFollowUpAt: now,
    lastValidFollowUpAt: now,
    nextFollowUpAt: null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: 0,
    pinnedAt: null,
    collaborativeDissolvedAt: null,
    lifecycleStatus: null,
    lifecycleCompletedAt: null,
    lifecycleCompletedBy: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Customer;
}

describe("isStaffUnclaimedPublicPoolCustomer", () => {
  it("is true for staff viewing status=public_pool", () => {
    assert.equal(
      isStaffUnclaimedPublicPoolCustomer(staffA, publicPoolCustomer()),
      true,
    );
  });

  it("is false for admin viewing public_pool", () => {
    assert.equal(
      isStaffUnclaimedPublicPoolCustomer(admin, publicPoolCustomer()),
      false,
    );
  });

  it("is false for staff owner after claim (active)", () => {
    assert.equal(
      isStaffUnclaimedPublicPoolCustomer(
        staffA,
        publicPoolCustomer({
          status: "active",
          ownerId: SEED_IDS.staffA,
        }),
      ),
      false,
    );
  });
});

describe("assertStaffCanViewCustomerDetailPage", () => {
  it("throws PUBLIC_POOL_DETAIL_DENIED for staff public_pool", () => {
    assert.throws(
      () => assertStaffCanViewCustomerDetailPage(staffA, publicPoolCustomer()),
      (err: unknown) => {
        assert.ok(err instanceof PermissionError);
        assert.equal(err.status, 403);
        assert.equal(err.auditAction, "PUBLIC_POOL_DETAIL_DENIED");
        return true;
      },
    );
  });

  it("allows admin public_pool detail", () => {
    assert.doesNotThrow(() =>
      assertStaffCanViewCustomerDetailPage(admin, publicPoolCustomer()),
    );
  });

  it("allows staff active owned customer detail", () => {
    const owned = publicPoolCustomer({
      id: SEED_IDS.customerStaffA,
      status: "active",
      ownerId: SEED_IDS.staffA,
    });
    assert.doesNotThrow(() =>
      assertStaffCanViewCustomerDetailPage(staffA, owned),
    );
    assert.equal(getCustomerAccessLevel(staffA, owned), "full");
  });
});

describe("non-public_pool access unchanged", () => {
  it("still denies staff on another staff active customer detail page assert", () => {
    const otherStaffCustomer = publicPoolCustomer({
      id: SEED_IDS.customerStaffB,
      status: "active",
      ownerId: SEED_IDS.staffB,
    });
    assert.equal(getCustomerAccessLevel(staffA, otherStaffCustomer), "denied");
    assert.doesNotThrow(() =>
      assertStaffCanViewCustomerDetailPage(staffA, otherStaffCustomer),
    );
    assert.throws(() => formatCustomerForUser(staffA, otherStaffCustomer));
  });
});
