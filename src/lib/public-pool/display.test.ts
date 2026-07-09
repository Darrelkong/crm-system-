import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canLinkPublicPoolCustomerToDetail,
  displayStaffPoolReasonPreview,
  formatPublicPoolAdminContact,
  formatPublicPoolDateCell,
  maskPublicPoolCustomerName,
  truncatePoolReason,
} from "./display";
import {
  displayPublicPoolReason,
  formatAdminPublicPoolCustomer,
  formatStaffPublicPoolCustomer,
} from "./queries";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";

describe("maskPublicPoolCustomerName", () => {
  it("masks Chinese names to first character + **", () => {
    assert.equal(maskPublicPoolCustomerName("張三三"), "張**");
  });

  it("masks short Chinese names to first character + **", () => {
    assert.equal(maskPublicPoolCustomerName("李"), "李**");
  });

  it("masks English names to first letter + **", () => {
    assert.equal(maskPublicPoolCustomerName("Daniel Smith"), "D**");
  });

  it("masks English single names to first letter + **", () => {
    assert.equal(maskPublicPoolCustomerName("Michael"), "M**");
  });

  it("returns empty string for empty input", () => {
    assert.equal(maskPublicPoolCustomerName(""), "");
  });

  it("returns empty string for whitespace-only input", () => {
    assert.equal(maskPublicPoolCustomerName("   "), "");
  });

  it("trims leading and trailing whitespace before masking", () => {
    assert.equal(maskPublicPoolCustomerName("  張三三  "), "張**");
    assert.equal(maskPublicPoolCustomerName("  Daniel  "), "D**");
  });

  it("returns empty string for null and undefined", () => {
    assert.equal(maskPublicPoolCustomerName(null), "");
    assert.equal(maskPublicPoolCustomerName(undefined), "");
  });
});

describe("truncatePoolReason", () => {
  it("truncates reasons longer than 3 characters", () => {
    assert.equal(truncatePoolReason("自動回收到公共池"), "自動回⋯");
  });

  it("returns exactly 3 characters unchanged", () => {
    assert.equal(truncatePoolReason("客戶是"), "客戶是");
  });

  it("returns fewer than 3 characters unchanged", () => {
    assert.equal(truncatePoolReason("無"), "無");
  });

  it("returns null for null, undefined, and empty values", () => {
    assert.equal(truncatePoolReason(null), null);
    assert.equal(truncatePoolReason(undefined), null);
    assert.equal(truncatePoolReason(""), null);
    assert.equal(truncatePoolReason("   "), null);
  });
});

describe("canLinkPublicPoolCustomerToDetail", () => {
  it("allows admin detail links only", () => {
    assert.equal(canLinkPublicPoolCustomerToDetail(true), true);
    assert.equal(canLinkPublicPoolCustomerToDetail(false), false);
  });
});

describe("formatPublicPoolDateCell", () => {
  it("returns empty label for null and blank values", () => {
    assert.equal(
      formatPublicPoolDateCell(null, (value) => value, "—"),
      "—",
    );
    assert.equal(
      formatPublicPoolDateCell("   ", (value) => value, "—"),
      "—",
    );
  });

  it("formats non-empty values", () => {
    assert.equal(
      formatPublicPoolDateCell("2026-07-08T10:00:00.000Z", () => "formatted"),
      "formatted",
    );
  });
});

describe("displayStaffPoolReasonPreview", () => {
  it("returns preview text for staff display", () => {
    assert.equal(displayStaffPoolReasonPreview("自動回⋯"), "自動回⋯");
  });

  it("returns empty label when preview is missing", () => {
    assert.equal(displayStaffPoolReasonPreview(null), "—");
  });
});

describe("formatPublicPoolAdminContact", () => {
  it("includes phone, wechatId, and email when present", () => {
    const contact = formatPublicPoolAdminContact({
      phone: "13800138000",
      wechatId: "wx_user",
      email: "pool@test.example",
    });
    assert.equal(contact.phone, "13800138000");
    assert.equal(contact.wechatId, "wx_user");
    assert.equal(contact.email, "pool@test.example");
  });

  it("uses empty label for missing phone", () => {
    const contact = formatPublicPoolAdminContact({});
    assert.equal(contact.phone, "—");
    assert.equal(contact.wechatId, null);
    assert.equal(contact.email, null);
  });
});

const adminUser = { id: SEED_IDS.admin, role: "admin" } as User;

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
    notes: "full notes",
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

describe("public pool list UI display helpers", () => {
  it("staff view uses preview only and admin view uses full poolReason", () => {
    const staffView = formatStaffPublicPoolCustomer(
      poolCustomer(),
      { canClaim: true, claimBlockedReasonKey: null },
      true,
    );
    const adminView = formatAdminPublicPoolCustomer(
      adminUser,
      poolCustomer(),
      { canClaim: true, claimBlockedReasonKey: null },
      true,
    );

    assert.equal(displayStaffPoolReasonPreview(staffView.poolReasonPreview), "自動回⋯");
    assert.equal("poolReason" in staffView, false);
    assert.equal(
      displayPublicPoolReason(adminView),
      "自動回收到公共池：超過 7 天无有效跟进",
    );
  });
});
