import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Customer } from "../../../drizzle/schema/customers";
import { SETTING_DEFAULTS } from "@/lib/settings/keys";
import { parseEffectiveSettings } from "@/lib/settings/effective";
import {
  getDaysWithoutValidFollowUp,
  getWarningDateKey,
} from "./days";

function minimalCustomer(overrides: Partial<Customer> = {}): Customer {
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
    entryMethod: null,
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
    lastValidFollowUpAt: null,
    nextFollowUpAt: null,
    reclamationCycleStartedAt: "2026-01-01T10:00:00.000Z",
    reclaimRuleGraceUntil: null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: 0,
    pinnedAt: null,
    pinnedSource: null,
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
    createdAt: "2026-01-01T10:00:00.000Z",
    updatedAt: "2026-01-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("reclamation business-day counting (Asia/Hong_Kong)", () => {
  it("uses HK calendar days, not raw UTC elapsed hours", () => {
    const customer = minimalCustomer({
      reclamationCycleStartedAt: "2026-01-01T10:00:00.000Z",
    });
    const sameHkDay = new Date("2026-01-01T14:00:00.000Z");
    const nextHkDay = new Date("2026-01-01T16:00:00.000Z");
    assert.equal(getDaysWithoutValidFollowUp(customer, sameHkDay), 0);
    assert.equal(getDaysWithoutValidFollowUp(customer, nextHkDay), 1);
  });

  it("does not shift business date across UTC midnight before HK midnight", () => {
    const customer = minimalCustomer({
      reclamationCycleStartedAt: "2026-01-07T16:00:00.000Z",
    });
    const beforeHkMidnight = new Date("2026-01-14T15:59:00.000Z");
    const afterHkMidnight = new Date("2026-01-14T16:01:00.000Z");
    assert.equal(getDaysWithoutValidFollowUp(customer, beforeHkMidnight), 6);
    assert.equal(getDaysWithoutValidFollowUp(customer, afterHkMidnight), 7);
  });

  it("warning date key uses HK calendar date", () => {
    const utcLate = new Date("2026-03-01T20:00:00.000Z");
    assert.equal(getWarningDateKey(utcLate), "2026-03-02");
  });

  it("defaults business timezone to Asia/Hong_Kong", () => {
    const settings = parseEffectiveSettings({ ...SETTING_DEFAULTS });
    assert.equal(settings.businessTimezone, "Asia/Hong_Kong");
  });

  it("normalizes legacy Asia/Shanghai stored timezone", () => {
    const settings = parseEffectiveSettings({
      ...SETTING_DEFAULTS,
      business_timezone: "Asia/Shanghai",
    });
    assert.equal(settings.businessTimezone, "Asia/Hong_Kong");
  });
});
