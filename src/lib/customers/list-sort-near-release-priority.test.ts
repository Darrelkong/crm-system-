import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Customer } from "../../../drizzle/schema/customers";
import { buildCustomerListOrderBy, compareCustomersForList } from "@/lib/customers/list-sort";

import {
  compareCustomersForListWithNearReleaseRisk,
  getNearReleaseRiskSortKey,
} from "@/lib/customers/list-sort-reclaim.test-helper";

const RECLAIM_DAYS = 45;
const NOW = new Date("2026-08-06T04:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgoIso(days: number): string {
  return new Date(NOW.getTime() - days * MS_PER_DAY).toISOString();
}

function makeCustomer(
  overrides: Partial<Customer> & Pick<Customer, "id" | "customerName">,
): Customer {
  const anchor = daysAgoIso(10);
  return {
    customerCode: null,
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: null,
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    requestedProjectCode: null,
    notes: null,
    salesStage: "negotiation",
    status: "active",
    ownerId: "11111111-1111-1111-1111-111111111102",
    releaserUserId: null,
    isPinned: 0,
    pinnedAt: null,
    lastFollowUpAt: null,
    lastValidFollowUpAt: anchor,
    nextFollowUpAt: null,
    reclamationCycleStartedAt: anchor,
    reclaimRuleGraceUntil: null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    collaborativeDissolvedAt: null,
    lifecycleStatus: null,
    lifecycleCompletedAt: null,
    lifecycleCompletedBy: null,
    lifecycleCompletionNotes: null,
    preferredName: null,
    gender: null,
    ageRange: null,
    preferredLanguage: null,
    preferredContactMethod: null,
    occupation: null,
    companyName: null,
    jobTitle: null,
    targetCountryOrRegion: null,
    primaryConcern: null,
    createdBy: "11111111-1111-1111-1111-111111111102",
    updatedBy: "11111111-1111-1111-1111-111111111102",
    createdAt: anchor,
    updatedAt: anchor,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    ...overrides,
  } as Customer;
}

// F4D replaces the former hidden 16-day/pin-first rule with configured warning priority.
const compare = (a: Customer, b: Customer, days = 3, collaborative = new Map<string, boolean>()) =>
  compareCustomersForListWithNearReleaseRisk(a, b, RECLAIM_DAYS, NOW, collaborative, days);
const row = (id: string, remaining: number, extra: Partial<Customer> = {}) => makeCustomer({ id, customerName: id,
  reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS - remaining), ...extra });
describe("operational reclaim warning priority", () => {
  it("adds rating/id keys and configured warning order only with reclaim settings", () => {
    assert.equal(buildCustomerListOrderBy(NOW).length, 8);
    assert.equal(buildCustomerListOrderBy(NOW, RECLAIM_DAYS, 3).length, 11);
  });
  it("uses configured boundary; broad visible countdown alone does not beat normal S", () => {
    const s = row("normal", 35, { customerRating: "S" });
    assert.ok(compare(row("warning", 3, { customerRating: "D" }), s) < 0);
    assert.ok(compare(row("visible", 4, { customerRating: "D" }), s) > 0);
    assert.equal(getNearReleaseRiskSortKey(row("visible", 4), RECLAIM_DAYS, NOW, { warningDaysBefore: 3 }).riskBucket, 1);
  });
  it("due then grace expiry then upcoming urgency then rating; warning beats pinned normal", () => {
    const due = row("due", 0), grace = row("grace", -2, { reclaimRuleGraceUntil: "2026-08-07T00:00:00.000Z" });
    const later = { ...grace, id: "later", reclaimRuleGraceUntil: "2026-08-08T00:00:00.000Z" };
    assert.ok(compare(due, grace) < 0); assert.ok(compare(grace, later) < 0);
    assert.ok(compare(later, row("one", 1)) < 0);
    assert.ok(compare(row("oneD", 1, { customerRating: "D" }), row("twoS", 2, { customerRating: "S" })) < 0);
    assert.ok(compare(row("twoS", 2, { customerRating: "S" }), row("twoA", 2, { customerRating: "A" })) < 0);
    assert.ok(compare(due, row("pin", 30, { isPinned: 1, customerRating: "S" })) < 0);
  });
  it("rating outranks pin; same-rating pin and existing follow-up buckets remain", () => {
    assert.ok(compare(row("a", 30, { customerRating: "A" }), row("b", 30, { customerRating: "B", isPinned: 1 })) < 0);
    assert.ok(compare(row("pin", 30, { customerRating: "A", isPinned: 1 }), row("plain", 30, { customerRating: "A" })) < 0);
    assert.ok(compareCustomersForList(row("overdue", 30, { nextFollowUpAt: daysAgoIso(1) }), row("future", 30, { nextFollowUpAt: "2027-01-01" }), NOW) < 0);
  });
  it("collaborator, pool, pinned and excluded-stage customers retain eligibility exemptions", () => {
    for (const extra of [{ status: "public_pool" }, { ownerId: null }, { salesStage: "paid" }, { salesStage: "on_hold" }, { salesStage: "converted" }, { salesStage: "closed_won" }, { isPinned: 1 }] as Partial<Customer>[]) {
      assert.ok(compare(row("excluded", 0, { ...extra, customerRating: "D" }), row("normal", 35, { customerRating: "S" })) > 0);
    }
    assert.ok(compare(row("collab", 0, { customerRating: "D" }), row("normal", 35, { customerRating: "S" }), 3, new Map([["collab", true]])) > 0);
  });
});
