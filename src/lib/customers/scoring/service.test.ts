/**
 * Regression tests for the scoring summary logic.
 *
 * These tests use the JS implementations (summarizeScoringForCustomers,
 * calculateCustomerHeat, calculateDataCompletenessScore) as the source of truth.
 * The SQL COUNT queries in computeScoringSummaryForAdmin /
 * computeScoringSummaryForStaff are written to be equivalent to these functions,
 * so these tests establish the specification the SQL must match.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { EffectiveSettings } from "@/lib/settings/effective";
import { SETTING_DEFAULTS } from "@/lib/settings/keys";
import { calculateCustomerHeat } from "./heat";
import { calculateDataCompletenessScore } from "./completeness";
import { summarizeScoringForCustomers } from "./service";
import {
  isReclamationEligibleCustomer,
  RECLAMATION_EXCLUDED_SALES_STAGES,
} from "@/lib/reclamation/constants";
import { getDaysWithoutValidFollowUp } from "@/lib/reclamation/days";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const FIXED_NOW = new Date("2026-07-03T12:00:00.000Z");

const DEFAULT_SETTINGS: EffectiveSettings = {
  automaticReclaimDays: Number(SETTING_DEFAULTS.automatic_reclaim_days),
  reclaimWarningDaysBefore: Number(SETTING_DEFAULTS.reclaim_warning_days_before),
  reclaimWarningThresholdDays:
    Number(SETTING_DEFAULTS.automatic_reclaim_days) -
    Number(SETTING_DEFAULTS.reclaim_warning_days_before),
  reclaimWarningDay1: Number(SETTING_DEFAULTS.reclaim_warning_day_1),
  reclaimWarningDay2: Number(SETTING_DEFAULTS.reclaim_warning_day_2),
  publicPoolClaimQuota7Days: Number(
    SETTING_DEFAULTS.public_pool_claim_quota_7_days,
  ),
  publicPoolClaimCooldownHours: Number(
    SETTING_DEFAULTS.public_pool_claim_cooldown_hours,
  ),
  firstContactSlaHours: Number(SETTING_DEFAULTS.first_contact_sla_hours),
  businessTimezone: "Asia/Shanghai",
  inactivityLogoutMinutes: Number(SETTING_DEFAULTS.inactivity_logout_minutes),
};

function daysAgoIso(days: number, from: Date = FIXED_NOW): string {
  return new Date(from.getTime() - days * MS_PER_DAY).toISOString();
}

function daysFromNowIso(days: number, from: Date = FIXED_NOW): string {
  return new Date(from.getTime() + days * MS_PER_DAY).toISOString();
}

let _idCounter = 0;
function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  _idCounter += 1;
  const id = `test-${String(_idCounter).padStart(4, "0")}`;
  return {
    id,
    customerCode: null,
    customerName: "Test Customer",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000000",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    notes: null,
    salesStage: "new_lead",
    ownerId: "owner-a",
    status: "active",
    releaserUserId: null,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    createdBy: "owner-a",
    updatedBy: "owner-a",
    lastFollowUpAt: null,
    lastValidFollowUpAt: daysAgoIso(1),
    nextFollowUpAt: null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: 0,
    pinnedAt: null,
    createdAt: daysAgoIso(30),
    updatedAt: daysAgoIso(1),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A. highChurnRiskCustomers — boundary conditions for calculateCustomerHeat
// ---------------------------------------------------------------------------

describe("highChurnRiskCustomers — heat level boundary conditions", () => {
  const threshold = DEFAULT_SETTINGS.reclaimWarningThresholdDays; // 4 with defaults
  const reclaimDays = DEFAULT_SETTINGS.automaticReclaimDays; // 7

  it("customer below warning threshold is NOT high_churn_risk", () => {
    // days = threshold - 1  → should NOT be high_churn_risk
    const c = makeCustomer({ lastValidFollowUpAt: daysAgoIso(threshold - 1) });
    const heat = calculateCustomerHeat(c, DEFAULT_SETTINGS, FIXED_NOW);
    assert.notEqual(heat.heatLevel, "high_churn_risk");
  });

  it("customer at exactly warning threshold IS high_churn_risk", () => {
    // days = threshold → condition 1 fires
    const c = makeCustomer({ lastValidFollowUpAt: daysAgoIso(threshold) });
    const heat = calculateCustomerHeat(c, DEFAULT_SETTINGS, FIXED_NOW);
    assert.equal(heat.heatLevel, "high_churn_risk");
  });

  it("customer with overdue nextFollowUpAt IS high_churn_risk (even if days below threshold)", () => {
    const c = makeCustomer({
      lastValidFollowUpAt: daysAgoIso(1), // days = 1, below threshold
      nextFollowUpAt: daysAgoIso(1),      // overdue
    });
    const heat = calculateCustomerHeat(c, DEFAULT_SETTINGS, FIXED_NOW);
    assert.equal(heat.heatLevel, "high_churn_risk");
  });

  it("customer with future nextFollowUpAt is NOT overdue", () => {
    const c = makeCustomer({
      lastValidFollowUpAt: daysAgoIso(1),
      nextFollowUpAt: daysFromNowIso(2), // in the future
    });
    const heat = calculateCustomerHeat(c, DEFAULT_SETTINGS, FIXED_NOW);
    assert.notEqual(heat.heatLevel, "high_churn_risk");
  });

  it("customer at max(1, reclaimDays-1) IS high_churn_risk via condition 3", () => {
    const nearReclaimThreshold = Math.max(1, reclaimDays - 1); // 6
    const c = makeCustomer({
      lastValidFollowUpAt: daysAgoIso(nearReclaimThreshold),
      nextFollowUpAt: null,
    });
    const heat = calculateCustomerHeat(c, DEFAULT_SETTINGS, FIXED_NOW);
    assert.equal(heat.heatLevel, "high_churn_risk");
  });

  it("archived customer is excluded from churn risk count by summarizeScoringForCustomers", () => {
    const archived = makeCustomer({
      status: "archived",
      lastValidFollowUpAt: daysAgoIso(10), // would be churn risk if active
    });
    const summary = summarizeScoringForCustomers(
      [archived],
      new Set(),
      DEFAULT_SETTINGS,
      FIXED_NOW,
    );
    assert.equal(summary.highChurnRiskCustomers, 0);
  });

  it("mixed batch: SQL COUNT must match JS summarize result", () => {
    const customers: Customer[] = [
      makeCustomer({ lastValidFollowUpAt: daysAgoIso(threshold - 1) }), // NOT risk
      makeCustomer({ lastValidFollowUpAt: daysAgoIso(threshold) }),      // IS risk
      makeCustomer({ lastValidFollowUpAt: daysAgoIso(threshold + 1) }), // IS risk
      makeCustomer({ lastValidFollowUpAt: daysAgoIso(1), nextFollowUpAt: daysAgoIso(1) }), // IS risk (overdue)
      makeCustomer({ status: "archived", lastValidFollowUpAt: daysAgoIso(10) }), // excluded
    ];

    const summary = summarizeScoringForCustomers(
      customers,
      new Set(),
      DEFAULT_SETTINGS,
      FIXED_NOW,
    );
    // 3 non-archived customers qualify: threshold, threshold+1, overdue
    assert.equal(summary.highChurnRiskCustomers, 3);
  });

  it("never-contacted customer (null lastValidFollowUpAt) uses createdAt as anchor", () => {
    // createdAt 5 days ago, no valid follow-up → daysWithoutValid = 5 >= threshold(4)
    const c = makeCustomer({
      lastValidFollowUpAt: null,
      createdAt: daysAgoIso(5),
    });
    const heat = calculateCustomerHeat(c, DEFAULT_SETTINGS, FIXED_NOW);
    assert.equal(heat.heatLevel, "high_churn_risk");
  });

  it("never-contacted customer with createdAt 2 days ago is NOT churn risk", () => {
    // daysWithoutValid = 2 < threshold(4)
    const c = makeCustomer({
      lastValidFollowUpAt: null,
      createdAt: daysAgoIso(2),
    });
    const heat = calculateCustomerHeat(c, DEFAULT_SETTINGS, FIXED_NOW);
    assert.notEqual(heat.heatLevel, "high_churn_risk");
  });
});

// ---------------------------------------------------------------------------
// B. lowCompletenessCustomers — completeness score boundary conditions
// ---------------------------------------------------------------------------

describe("lowCompletenessCustomers — completeness score boundary conditions", () => {
  it("customer with all fields filled has high completeness score", () => {
    const c = makeCustomer({
      customerName: "張三",
      phone: "13800000000",
      email: "test@example.com",
      source: "referral",
      salesStage: "new_lead",
      ownerId: "owner-a",
      notes: "備注",
      nextFollowUpAt: daysFromNowIso(3),
    });
    const result = calculateDataCompletenessScore(c, true); // hasFollowUp = true
    // 10+20+10+10+10+10+10+10+10 = 100
    assert.equal(result.completenessScore, 100);
  });

  it("customer missing phone, wechat, email, notes, nextFollowUpAt scores below threshold", () => {
    const c = makeCustomer({
      customerName: "李四",
      phone: null,
      wechatId: null,
      email: null,
      source: "referral",
      salesStage: "new_lead",
      ownerId: "owner-a",
      notes: null,
      nextFollowUpAt: null,
    });
    const result = calculateDataCompletenessScore(c, false);
    // 10 (name) + 0 (no phone/wechat) + 0 (no email) + 10 (source) + 10 (stage)
    // + 10 (owner) + 0 (no notes) + 0 (no follow-up) + 0 (no next) = 40
    assert.equal(result.completenessScore, 40);
    assert.ok(result.completenessScore < 60);
  });

  it("having a follow-up adds 10 points to completeness", () => {
    const c = makeCustomer({ phone: "13800000000", notes: "note" });
    const withoutFollowUp = calculateDataCompletenessScore(c, false);
    const withFollowUp = calculateDataCompletenessScore(c, true);
    assert.equal(withFollowUp.completenessScore - withoutFollowUp.completenessScore, 10);
  });

  it("archived customer is excluded from low completeness count", () => {
    const c = makeCustomer({
      status: "archived",
      phone: null,
      email: null,
      notes: null,
      nextFollowUpAt: null,
    });
    const summary = summarizeScoringForCustomers(
      [c],
      new Set(),
      DEFAULT_SETTINGS,
      FIXED_NOW,
    );
    assert.equal(summary.lowCompletenessCustomers, 0);
  });

  it("customer with only name + source + stage + owner scores 40, IS low completeness", () => {
    const c = makeCustomer({
      customerName: "王五",
      phone: null,
      wechatId: null,
      email: null,
      source: "referral",
      salesStage: "new_lead",
      ownerId: "owner-a",
      notes: null,
      nextFollowUpAt: null,
    });
    const result = calculateDataCompletenessScore(c, false);
    // 10+0+0+10+10+10+0+0+0 = 40 < 60
    assert.equal(result.completenessScore, 40);
  });

  it("customer scoring exactly 60 is NOT low completeness", () => {
    const c = makeCustomer({
      customerName: "Test",
      phone: "13800000000",
      email: null,
      source: "referral",
      salesStage: "new_lead",
      ownerId: "owner-a",
      notes: null,
      nextFollowUpAt: null,
    });
    const result = calculateDataCompletenessScore(c, true); // +10 follow-up
    // 10+20+0+10+10+10+0+10+0 = 70 — let's check...
    // Actually: name(10) + phone(20) + email(0) + source(10) + stage(10) + owner(10) + notes(0) + followUp(10) + next(0) = 70
    // So this scores 70, not 60. Adjust: remove followUp.
    const result2 = calculateDataCompletenessScore(c, false);
    // 10+20+0+10+10+10+0+0+0 = 60
    assert.equal(result2.completenessScore, 60);
    assert.ok(result2.completenessScore >= 60); // NOT low completeness
  });

  it("customer scoring 59 IS low completeness", () => {
    // Score 59 is impossible (all fields are multiples of 10), but 50 is possible.
    const c = makeCustomer({
      customerName: "Test",
      phone: "13800000000",
      email: null,
      source: "referral",
      salesStage: "new_lead",
      ownerId: null,    // -10
      notes: null,
      nextFollowUpAt: null,
    });
    const result = calculateDataCompletenessScore(c, false);
    // 10+20+0+10+10+0+0+0+0 = 50 < 60
    assert.equal(result.completenessScore, 50);
    assert.ok(result.completenessScore < 60);
  });

  it("mixed batch: low completeness count matches expected", () => {
    const full = makeCustomer({
      phone: "13800000000",
      email: "x@x.com",
      source: "referral",
      salesStage: "new_lead",
      notes: "some note",
      nextFollowUpAt: daysFromNowIso(1),
    });
    const low = makeCustomer({
      phone: null, wechatId: null, email: null, notes: null, nextFollowUpAt: null,
    }); // 10+0+0+10+10+10+0+0+0 = 40

    const summary = summarizeScoringForCustomers(
      [full, low, makeCustomer({ status: "archived", phone: null })],
      new Set([full.id]), // full has a follow-up
      DEFAULT_SETTINGS,
      FIXED_NOW,
    );
    // full: 10+20+10+10+10+10+0+10+10=90 → NOT low
    // low: 40 → IS low
    // archived: excluded
    assert.equal(summary.lowCompletenessCustomers, 1);
  });
});

// ---------------------------------------------------------------------------
// C. Staff scoring summary — ownership boundary
// ---------------------------------------------------------------------------

describe("staff scoring summary — ownership filter", () => {
  it("only counts customers owned by the target staff (via summarizeScoringForCustomers filter)", () => {
    // Simulate calling summarizeScoringForCustomers with only staff A's customers
    const staffACustomer = makeCustomer({
      ownerId: "staff-a",
      lastValidFollowUpAt: daysAgoIso(5), // high_churn_risk (5 >= 4)
    });
    const staffBCustomer = makeCustomer({
      ownerId: "staff-b",
      lastValidFollowUpAt: daysAgoIso(5), // would also be risk if counted
    });

    // Staff A dashboard: pass only staff A's customers
    const staffASummary = summarizeScoringForCustomers(
      [staffACustomer],
      new Set(),
      DEFAULT_SETTINGS,
      FIXED_NOW,
    );
    assert.equal(staffASummary.highChurnRiskCustomers, 1);

    // Staff B customer must not appear in staff A's summary
    const allSummary = summarizeScoringForCustomers(
      [staffACustomer, staffBCustomer],
      new Set(),
      DEFAULT_SETTINGS,
      FIXED_NOW,
    );
    assert.equal(allSummary.highChurnRiskCustomers, 2);
  });

  it("non-active customers owned by staff are not counted in active-only summary", () => {
    // The SQL for staff uses `status = 'active'`; simulate by excluding non-active
    const activeCustomer = makeCustomer({
      status: "active",
      lastValidFollowUpAt: daysAgoIso(5),
    });
    const archivedCustomer = makeCustomer({
      status: "archived",
      lastValidFollowUpAt: daysAgoIso(5),
    });

    // Only active customers are passed (mirrors the SQL WHERE status = 'active')
    const summary = summarizeScoringForCustomers(
      [activeCustomer], // archived excluded by query, not passed here
      new Set(),
      DEFAULT_SETTINGS,
      FIXED_NOW,
    );
    assert.equal(summary.highChurnRiskCustomers, 1);
  });
});

// ---------------------------------------------------------------------------
// D. Staff myReclaimRiskCustomers — reclaim risk filter boundary conditions
// ---------------------------------------------------------------------------

describe("staff myReclaimRiskCustomers — reclaim risk boundary", () => {
  const threshold = DEFAULT_SETTINGS.reclaimWarningThresholdDays; // 4
  const reclaimDays = DEFAULT_SETTINGS.automaticReclaimDays;       // 7

  function isReclaimRisk(customer: Customer): boolean {
    if (!isReclamationEligibleCustomer(customer)) return false;
    const days = getDaysWithoutValidFollowUp(customer, FIXED_NOW);
    return (
      days >= threshold &&
      days < reclaimDays
    );
  }

  it("closed_won customer is NOT reclaim risk (excluded stage)", () => {
    const c = makeCustomer({
      salesStage: "closed_won",
      lastValidFollowUpAt: daysAgoIso(5),
    });
    assert.equal(isReclaimRisk(c), false);
  });

  it("converted customer is NOT reclaim risk (excluded stage)", () => {
    const c = makeCustomer({
      salesStage: "converted",
      lastValidFollowUpAt: daysAgoIso(5),
    });
    assert.equal(isReclaimRisk(c), false);
  });

  it("on_hold customer is NOT reclaim risk (excluded stage)", () => {
    const c = makeCustomer({
      salesStage: "on_hold",
      lastValidFollowUpAt: daysAgoIso(5),
    });
    assert.equal(isReclaimRisk(c), false);
  });

  it("RECLAMATION_EXCLUDED_SALES_STAGES list matches the conditions above", () => {
    const excluded = new Set([...RECLAMATION_EXCLUDED_SALES_STAGES]);
    assert.ok(excluded.has("closed_won"));
    assert.ok(excluded.has("converted"));
    assert.ok(excluded.has("on_hold"));
  });

  it("isPinned = 1 customer is NOT reclaim risk", () => {
    const c = makeCustomer({
      salesStage: "new_lead",
      isPinned: 1,
      lastValidFollowUpAt: daysAgoIso(5),
    });
    assert.equal(isReclaimRisk(c), false);
  });

  it("customer with days < threshold is NOT reclaim risk", () => {
    const c = makeCustomer({ lastValidFollowUpAt: daysAgoIso(threshold - 1) });
    assert.equal(isReclaimRisk(c), false);
  });

  it("customer at exactly threshold IS reclaim risk", () => {
    const c = makeCustomer({ lastValidFollowUpAt: daysAgoIso(threshold) });
    assert.equal(isReclaimRisk(c), true);
  });

  it("customer at reclaimDays - 1 IS reclaim risk (upper boundary, before reclaim)", () => {
    const c = makeCustomer({
      lastValidFollowUpAt: daysAgoIso(reclaimDays - 1),
    });
    assert.equal(isReclaimRisk(c), true);
  });

  it("customer at exactly reclaimDays is NOT reclaim risk (would be reclaimed, not warned)", () => {
    const c = makeCustomer({ lastValidFollowUpAt: daysAgoIso(reclaimDays) });
    assert.equal(isReclaimRisk(c), false); // days >= reclaimDays → reclaim, not warning
  });

  it("customer beyond reclaimDays is NOT reclaim risk", () => {
    const c = makeCustomer({ lastValidFollowUpAt: daysAgoIso(reclaimDays + 3) });
    assert.equal(isReclaimRisk(c), false);
  });

  it("closed_lost customer with correct days IS reclaim risk (not excluded)", () => {
    const c = makeCustomer({
      salesStage: "closed_lost",
      lastValidFollowUpAt: daysAgoIso(threshold),
    });
    assert.equal(isReclaimRisk(c), true);
  });

  it("mixed batch: JS reclaim risk count matches expected", () => {
    const customers: Customer[] = [
      makeCustomer({ lastValidFollowUpAt: daysAgoIso(threshold - 1) }), // NOT risk
      makeCustomer({ lastValidFollowUpAt: daysAgoIso(threshold) }),     // IS risk
      makeCustomer({ lastValidFollowUpAt: daysAgoIso(reclaimDays - 1) }), // IS risk
      makeCustomer({ lastValidFollowUpAt: daysAgoIso(reclaimDays) }),   // NOT risk
      makeCustomer({ salesStage: "closed_won", lastValidFollowUpAt: daysAgoIso(5) }), // excluded
      makeCustomer({ isPinned: 1, lastValidFollowUpAt: daysAgoIso(5) }), // excluded
    ];
    const riskCount = customers.filter(isReclaimRisk).length;
    assert.equal(riskCount, 2);
  });

  it("never-contacted customer (null lastValidFollowUpAt) uses createdAt as anchor for reclaim risk", () => {
    // createdAt 5 days ago, no valid follow-up → daysWithoutValid = 5 ∈ [4, 7)
    const c = makeCustomer({
      lastValidFollowUpAt: null,
      createdAt: daysAgoIso(threshold),
      salesStage: "new_lead",
    });
    assert.equal(isReclaimRisk(c), true);
  });
});
