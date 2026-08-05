import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Customer } from "../../../drizzle/schema/customers";
import { getDaysWithoutValidFollowUp } from "./days";
import { RECLAIM_RULE_SHORTENING_GRACE_HOURS } from "./grace-period";

function buildCustomer(
  idleDays: number,
  now: Date,
  overrides: Partial<Customer> = {},
): Customer {
  const anchor = new Date(
    now.getTime() - idleDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  return {
    id: "c1",
    customerCode: null,
    customerName: "Test",
    nameStatus: "confirmed",
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
    ownerId: "u1",
    status: "active",
    releaserUserId: null,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    createdBy: "u1",
    updatedBy: "u1",
    lastFollowUpAt: null,
    lastValidFollowUpAt: anchor,
    nextFollowUpAt: null,
    reclamationCycleStartedAt: anchor,
    reclaimRuleGraceUntil: null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: 0,
    pinnedAt: null,
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
    createdAt: anchor,
    updatedAt: anchor,
    ...overrides,
  };
}

describe("rule shortening grace eligibility (unit)", () => {
  const now = new Date("2026-07-01T12:00:00.000Z");

  it("customer over new threshold after 75→45 shorten would need grace", () => {
    const customer = buildCustomer(50, now);
    const idleDays = getDaysWithoutValidFollowUp(customer, now);
    assert.ok(idleDays >= 45);
    assert.ok(idleDays < 75);
  });

  it("grace period is 24 hours", () => {
    assert.equal(RECLAIM_RULE_SHORTENING_GRACE_HOURS, 24);
  });

  it("natural expiry at reclaim threshold does not imply grace", () => {
    const customer = buildCustomer(45, now);
    assert.equal(getDaysWithoutValidFollowUp(customer, now), 45);
    assert.equal(customer.reclaimRuleGraceUntil, null);
  });
});
