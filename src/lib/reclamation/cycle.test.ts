import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Customer } from "../../../drizzle/schema/customers";
import {
  buildReclamationCycleResetFields,
  getReclamationCycleStartedAt,
  isReclaimGraceActive,
} from "./cycle";

function minimalCustomer(
  overrides: Partial<Customer> = {},
): Customer {
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
    lastValidFollowUpAt: "2026-01-10T00:00:00.000Z",
    nextFollowUpAt: null,
    reclamationCycleStartedAt: null,
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("reclamation cycle anchor", () => {
  it("prefers explicit cycle start over follow-up and createdAt", () => {
    const customer = minimalCustomer({
      reclamationCycleStartedAt: "2026-02-01T00:00:00.000Z",
      lastValidFollowUpAt: "2026-01-10T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(
      getReclamationCycleStartedAt(customer),
      "2026-02-01T00:00:00.000Z",
    );
  });

  it("falls back to lastValidFollowUpAt then createdAt", () => {
    assert.equal(
      getReclamationCycleStartedAt(minimalCustomer()),
      "2026-01-10T00:00:00.000Z",
    );
    assert.equal(
      getReclamationCycleStartedAt(
        minimalCustomer({ lastValidFollowUpAt: null }),
      ),
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("reset fields clear grace and set cycle anchor", () => {
    assert.deepEqual(
      buildReclamationCycleResetFields("2026-03-01T00:00:00.000Z"),
      {
        reclamationCycleStartedAt: "2026-03-01T00:00:00.000Z",
        reclaimRuleGraceUntil: null,
      },
    );
  });

  it("grace active only before until instant", () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    assert.equal(
      isReclaimGraceActive(
        { reclaimRuleGraceUntil: "2026-06-02T00:00:00.000Z" },
        now,
      ),
      true,
    );
    assert.equal(
      isReclaimGraceActive(
        { reclaimRuleGraceUntil: "2026-06-01T00:00:00.000Z" },
        now,
      ),
      false,
    );
    assert.equal(isReclaimGraceActive({ reclaimRuleGraceUntil: null }, now), false);
  });
});
