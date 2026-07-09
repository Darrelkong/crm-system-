import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  displayPublicPoolReason,
  evaluateCustomerClaimEligibility,
  formatAdminPublicPoolCustomer,
  formatPublicPoolCustomer,
  formatStaffPublicPoolCustomer,
  getSelfReleaseClaimBlockState,
  isAdminPublicPoolCustomerView,
} from "@/lib/public-pool/queries";
import { SELF_RELEASE_CLAIM_BLOCK_DAYS } from "@/lib/public-pool/constants";

const adminUser = { id: SEED_IDS.admin, role: "admin" } as User;
const staffUser = { id: SEED_IDS.staffA, role: "staff" } as User;

function poolCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "pool-customer-001",
    customerCode: null,
    customerName: "張三三",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800138000",
    wechatId: "wx_test_user",
    email: "pool@test.example",
    source: "referral",
    sourceRemark: "internal remark",
    requestedProjectName: null,
    notes: "full notes should not leak to staff",
    salesStage: "interested",
    ownerId: null,
    status: "public_pool",
    releaserUserId: SEED_IDS.staffB,
    poolEnteredAt: "2026-07-08T10:00:00.000Z",
    poolReason: "自動回收到公共池：超過 7 天无有效跟进",
    releasedBy: SEED_IDS.staffB,
    previousOwnerId: SEED_IDS.staffB,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    createdBy: SEED_IDS.admin,
    updatedBy: SEED_IDS.admin,
    lastFollowUpAt: "2026-07-07T09:00:00.000Z",
    lastValidFollowUpAt: "2026-07-07T09:00:00.000Z",
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
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-08T10:00:00.000Z",
    ...overrides,
  } as Customer;
}

const claimAllowed = { canClaim: true, claimBlockedReasonKey: null } as const;

const staffStatusOk = {
  claimedInLast7Days: 0,
  remainingQuota: 5,
  quotaLimit: 5,
  cooldownHours: 12,
  cooldownUntil: null,
  inCooldown: false,
  canClaimNow: true,
  blockedReasonKey: null,
  blockedReasonParams: undefined,
};

const FIXED_NOW = new Date("2026-07-09T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgoIso(days: number, now = FIXED_NOW): string {
  return new Date(now.getTime() - days * MS_PER_DAY).toISOString();
}

describe("formatStaffPublicPoolCustomer", () => {
  it("does not expose full customerName, poolReason, or contact fields", () => {
    const view = formatStaffPublicPoolCustomer(
      poolCustomer(),
      claimAllowed,
      true,
    );

    assert.equal("customerName" in view, false);
    assert.equal("poolReason" in view, false);
    assert.equal("phone" in view, false);
    assert.equal("email" in view, false);
    assert.equal("wechatId" in view, false);
    assert.equal("notes" in view, false);
    assert.equal("sourceRemark" in view, false);
    assert.equal(view.maskedName, "張**");
    assert.equal(view.poolReasonPreview, "自動回⋯");
    assert.equal(view.accessLevel, "masked");
    assert.equal(view.isMasked, true);
    assert.equal(view.lastFollowUpAt, "2026-07-07T09:00:00.000Z");
    assert.equal(view.canClaim, true);
  });
});

describe("formatAdminPublicPoolCustomer", () => {
  it("includes full customerName, poolReason, and contact fields", () => {
    const view = formatAdminPublicPoolCustomer(
      adminUser,
      poolCustomer(),
      claimAllowed,
      true,
    );

    assert.equal(view.customerName, "張三三");
    assert.equal(view.maskedName, "張**");
    assert.equal(view.poolReason, "自動回收到公共池：超過 7 天无有效跟进");
    assert.equal(view.poolReasonPreview, "自動回⋯");
    assert.equal(view.phone, "13800138000");
    assert.equal(view.email, "pool@test.example");
    assert.equal(view.wechatId, "wx_test_user");
    assert.equal(view.notes, "full notes should not leak to staff");
    assert.equal(view.sourceRemark, "internal remark");
    assert.equal(view.accessLevel, "full");
    assert.equal(view.isMasked, false);
    assert.equal(isAdminPublicPoolCustomerView(view), true);
  });
});

describe("formatPublicPoolCustomer role dispatch", () => {
  it("returns staff view for staff users", () => {
    const view = formatPublicPoolCustomer(
      staffUser,
      poolCustomer(),
      claimAllowed,
      false,
    );
    assert.equal(view.accessLevel, "masked");
    assert.equal("customerName" in view, false);
  });

  it("returns admin view for admin users", () => {
    const view = formatPublicPoolCustomer(
      adminUser,
      poolCustomer(),
      claimAllowed,
      false,
    );
    assert.equal(view.accessLevel, "full");
    assert.ok(isAdminPublicPoolCustomerView(view));
    assert.equal(view.customerName, "張三三");
  });
});

describe("displayPublicPoolReason", () => {
  it("shows poolReasonPreview for staff views", () => {
    const view = formatStaffPublicPoolCustomer(
      poolCustomer(),
      claimAllowed,
      true,
    );
    assert.equal(displayPublicPoolReason(view), "自動回⋯");
    assert.equal("poolReason" in view, false);
  });

  it("prefers full poolReason for admin views", () => {
    const view = formatAdminPublicPoolCustomer(
      adminUser,
      poolCustomer(),
      claimAllowed,
      true,
    );
    assert.equal(
      displayPublicPoolReason(view),
      "自動回收到公共池：超過 7 天无有效跟进",
    );
  });

  it("falls back to poolReasonPreview when admin poolReason is null", () => {
    const view = formatAdminPublicPoolCustomer(
      adminUser,
      poolCustomer({ poolReason: null }),
      claimAllowed,
      true,
    );
    const viewWithPreview = {
      ...view,
      poolReason: null,
      poolReasonPreview: "預覽⋯",
    };
    assert.equal(displayPublicPoolReason(viewWithPreview), "預覽⋯");
  });
});

describe("evaluateCustomerClaimEligibility", () => {
  it("blocks staff self-released pool customer within 7-day window", () => {
    const customer = poolCustomer({
      releasedBy: SEED_IDS.staffA,
      releaserUserId: SEED_IDS.staffA,
      poolEnteredAt: daysAgoIso(3),
    });
    const result = evaluateCustomerClaimEligibility(
      staffUser,
      customer,
      staffStatusOk,
      FIXED_NOW,
    );
    assert.equal(result.canClaim, false);
    assert.equal(result.claimBlockedReasonKey, "selfReleased");
    assert.equal(
      result.claimBlockedReasonParams?.blockDays,
      String(SELF_RELEASE_CLAIM_BLOCK_DAYS),
    );
    assert.equal(result.claimBlockedReasonParams?.releasedBy, SEED_IDS.staffA);
    assert.equal(result.claimBlockedReasonParams?.poolEnteredAt, daysAgoIso(3));
    assert.ok(result.claimBlockedReasonParams?.blockedUntil);
    assert.ok(result.claimBlockedReasonParams?.remainingDays);
    assert.ok(result.claimBlockedReasonParams?.remainingHours);
  });

  it("allows staff self-released pool customer after 7-day window", () => {
    const customer = poolCustomer({
      releasedBy: SEED_IDS.staffA,
      releaserUserId: SEED_IDS.staffA,
      poolEnteredAt: daysAgoIso(8),
    });
    const result = evaluateCustomerClaimEligibility(
      staffUser,
      customer,
      staffStatusOk,
      FIXED_NOW,
    );
    assert.equal(result.canClaim, true);
    assert.equal(result.claimBlockedReasonKey, null);
  });

  it("still applies cooldown after self-release window expires", () => {
    const customer = poolCustomer({
      releasedBy: SEED_IDS.staffA,
      releaserUserId: SEED_IDS.staffA,
      poolEnteredAt: daysAgoIso(8),
    });
    const result = evaluateCustomerClaimEligibility(
      staffUser,
      customer,
      {
        ...staffStatusOk,
        inCooldown: true,
        canClaimNow: false,
        blockedReasonKey: "cooldown",
        blockedReasonParams: { hours: "12" },
        cooldownUntil: new Date(FIXED_NOW.getTime() + 3600000).toISOString(),
      },
      FIXED_NOW,
    );
    assert.equal(result.canClaim, false);
    assert.equal(result.claimBlockedReasonKey, "cooldown");
  });

  it("still applies quota after self-release window expires", () => {
    const customer = poolCustomer({
      releasedBy: SEED_IDS.staffA,
      releaserUserId: SEED_IDS.staffA,
      poolEnteredAt: daysAgoIso(8),
    });
    const result = evaluateCustomerClaimEligibility(
      staffUser,
      customer,
      {
        ...staffStatusOk,
        remainingQuota: 0,
        claimedInLast7Days: 5,
        canClaimNow: false,
        blockedReasonKey: "quotaExceeded",
        blockedReasonParams: { limit: "5" },
      },
      FIXED_NOW,
    );
    assert.equal(result.canClaim, false);
    assert.equal(result.claimBlockedReasonKey, "quotaExceeded");
  });

  it("allows admin to claim self-released pool customer within block window", () => {
    const customer = poolCustomer({
      releasedBy: SEED_IDS.admin,
      releaserUserId: SEED_IDS.admin,
      poolEnteredAt: daysAgoIso(1),
    });
    const result = evaluateCustomerClaimEligibility(
      adminUser,
      customer,
      null,
      FIXED_NOW,
    );
    assert.equal(result.canClaim, true);
    assert.equal(result.claimBlockedReasonKey, null);
  });

  it("does not block staff for auto-reclaimed customers with releasedBy null", () => {
    const customer = poolCustomer({
      releasedBy: null,
      releaserUserId: null,
      previousOwnerId: SEED_IDS.staffA,
      poolEnteredAt: daysAgoIso(1),
    });
    const result = evaluateCustomerClaimEligibility(
      staffUser,
      customer,
      staffStatusOk,
      FIXED_NOW,
    );
    assert.equal(result.canClaim, true);
    assert.equal(result.claimBlockedReasonKey, null);
  });

  it("allows staff to claim pool customer released by another staff", () => {
    const customer = poolCustomer({
      releasedBy: SEED_IDS.staffB,
      releaserUserId: SEED_IDS.staffB,
      poolEnteredAt: daysAgoIso(1),
    });
    const result = evaluateCustomerClaimEligibility(
      staffUser,
      customer,
      staffStatusOk,
      FIXED_NOW,
    );
    assert.equal(result.canClaim, true);
    assert.equal(result.claimBlockedReasonKey, null);
  });
});

describe("getSelfReleaseClaimBlockState audit metadata", () => {
  it("returns blockDays, poolEnteredAt, and blockedUntil for in-window self-release", () => {
    const customer = poolCustomer({
      releasedBy: SEED_IDS.staffA,
      releaserUserId: SEED_IDS.staffA,
      poolEnteredAt: daysAgoIso(2),
    });
    const state = getSelfReleaseClaimBlockState(
      customer,
      SEED_IDS.staffA,
      FIXED_NOW,
    );
    assert.ok(state);
    assert.equal(state.blocked, true);
    assert.equal(state.blockDays, SELF_RELEASE_CLAIM_BLOCK_DAYS);
    assert.equal(state.poolEnteredAt, daysAgoIso(2));
    assert.equal(
      state.blockedUntil,
      new Date(
        new Date(daysAgoIso(2)).getTime() +
          SELF_RELEASE_CLAIM_BLOCK_DAYS * MS_PER_DAY,
      ).toISOString(),
    );
  });

  it("returns blocked=false after the window expires", () => {
    const customer = poolCustomer({
      releasedBy: SEED_IDS.staffA,
      poolEnteredAt: daysAgoIso(10),
    });
    const state = getSelfReleaseClaimBlockState(
      customer,
      SEED_IDS.staffA,
      FIXED_NOW,
    );
    assert.ok(state);
    assert.equal(state.blocked, false);
  });
});
