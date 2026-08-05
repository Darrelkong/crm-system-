import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Customer } from "../../../drizzle/schema/customers";
import {
  buildReclamationCountdownDisplay,
  classifyCountdownState,
  getGraceHoursRemaining,
  getProjectedReclaimAt,
  getReclamationCountdownBadgeClassName,
  getReclamationCountdownBadgeVariant,
} from "./countdown-display";

const FIXED_NOW = new Date("2026-08-06T04:00:00.000Z"); // HK 12:00
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgoIso(days: number): string {
  return new Date(FIXED_NOW.getTime() - days * MS_PER_DAY).toISOString();
}

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  const anchor = daysAgoIso(10);
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
    customerCode: null,
    customerName: "Countdown Test",
    nameStatus: "confirmed",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000000",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    requestedProjectCode: null,
    notes: null,
    salesStage: "negotiation",
    ownerId: "11111111-1111-1111-1111-111111111102",
    status: "active",
    releaserUserId: null,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    createdBy: "11111111-1111-1111-1111-111111111101",
    updatedBy: "11111111-1111-1111-1111-111111111101",
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
  } as Customer;
}

const settings = { automaticReclaimDays: 45 };

describe("classifyCountdownState", () => {
  it("maps day boundaries to the correct visual states", () => {
    assert.equal(classifyCountdownState(16), "normal");
    assert.equal(classifyCountdownState(15), "normal");
    assert.equal(classifyCountdownState(14), "warning");
    assert.equal(classifyCountdownState(8), "warning");
    assert.equal(classifyCountdownState(7), "high_risk");
    assert.equal(classifyCountdownState(2), "high_risk");
    assert.equal(classifyCountdownState(1), "urgent");
    assert.equal(classifyCountdownState(0), null);
    assert.equal(classifyCountdownState(-1), null);
  });
});

describe("buildReclamationCountdownDisplay", () => {
  it("shows normal countdown for eligible customers with 16+ days remaining", () => {
    const customer = makeCustomer({
      lastValidFollowUpAt: daysAgoIso(29),
      reclamationCycleStartedAt: daysAgoIso(29),
    });
    const display = buildReclamationCountdownDisplay(
      customer,
      settings,
      FIXED_NOW,
    );
    assert.ok(display);
    assert.equal(display.state, "normal");
    assert.equal(display.daysRemaining, 16);
  });

  it("shows warning at 14 and 8 days remaining", () => {
    const at14 = buildReclamationCountdownDisplay(
      makeCustomer({
        lastValidFollowUpAt: daysAgoIso(31),
        reclamationCycleStartedAt: daysAgoIso(31),
      }),
      settings,
      FIXED_NOW,
    );
    const at8 = buildReclamationCountdownDisplay(
      makeCustomer({
        lastValidFollowUpAt: daysAgoIso(37),
        reclamationCycleStartedAt: daysAgoIso(37),
      }),
      settings,
      FIXED_NOW,
    );
    assert.equal(at14?.state, "warning");
    assert.equal(at14?.daysRemaining, 14);
    assert.equal(at8?.state, "warning");
    assert.equal(at8?.daysRemaining, 8);
  });

  it("shows high_risk at 7 and 2 days remaining", () => {
    const at7 = buildReclamationCountdownDisplay(
      makeCustomer({
        lastValidFollowUpAt: daysAgoIso(38),
        reclamationCycleStartedAt: daysAgoIso(38),
      }),
      settings,
      FIXED_NOW,
    );
    const at2 = buildReclamationCountdownDisplay(
      makeCustomer({
        lastValidFollowUpAt: daysAgoIso(43),
        reclamationCycleStartedAt: daysAgoIso(43),
      }),
      settings,
      FIXED_NOW,
    );
    assert.equal(at7?.state, "high_risk");
    assert.equal(at7?.daysRemaining, 7);
    assert.equal(at2?.state, "high_risk");
    assert.equal(at2?.daysRemaining, 2);
  });

  it("shows urgent for tomorrow release", () => {
    const display = buildReclamationCountdownDisplay(
      makeCustomer({
        lastValidFollowUpAt: daysAgoIso(44),
        reclamationCycleStartedAt: daysAgoIso(44),
      }),
      settings,
      FIXED_NOW,
    );
    assert.equal(display?.state, "urgent");
    assert.equal(display?.daysRemaining, 1);
  });

  it("shows due when past reclaim threshold without grace", () => {
    const display = buildReclamationCountdownDisplay(
      makeCustomer({
        lastValidFollowUpAt: daysAgoIso(45),
        reclamationCycleStartedAt: daysAgoIso(45),
      }),
      settings,
      FIXED_NOW,
    );
    assert.equal(display?.state, "due");
    assert.equal(display?.daysRemaining, null);
  });

  it("shows grace instead of due when rule grace is active", () => {
    const graceUntil = new Date(
      FIXED_NOW.getTime() + 5.2 * 60 * 60 * 1000,
    ).toISOString();
    const display = buildReclamationCountdownDisplay(
      makeCustomer({
        lastValidFollowUpAt: daysAgoIso(50),
        reclamationCycleStartedAt: daysAgoIso(50),
        reclaimRuleGraceUntil: graceUntil,
      }),
      settings,
      FIXED_NOW,
    );
    assert.equal(display?.state, "grace");
    assert.equal(display?.graceHoursRemaining, 6);
    assert.equal(display?.graceUntil, graceUntil);
  });

  it("rounds grace under one hour up to 1", () => {
    const graceUntil = new Date(
      FIXED_NOW.getTime() + 20 * 60 * 1000,
    ).toISOString();
    assert.equal(getGraceHoursRemaining(graceUntil, FIXED_NOW), 1);
  });

  it("hides countdown for public pool, no owner, pinned, excluded stages, collaborative", () => {
    assert.equal(
      buildReclamationCountdownDisplay(
        makeCustomer({ status: "public_pool", ownerId: null }),
        settings,
        FIXED_NOW,
      ),
      null,
    );
    assert.equal(
      buildReclamationCountdownDisplay(
        makeCustomer({ ownerId: null }),
        settings,
        FIXED_NOW,
      ),
      null,
    );
    assert.equal(
      buildReclamationCountdownDisplay(
        makeCustomer({ isPinned: 1 }),
        settings,
        FIXED_NOW,
      ),
      null,
    );
    for (const salesStage of ["closed_won", "converted", "paid", "on_hold"]) {
      assert.equal(
        buildReclamationCountdownDisplay(
          makeCustomer({ salesStage }),
          settings,
          FIXED_NOW,
        ),
        null,
      );
    }
    assert.equal(
      buildReclamationCountdownDisplay(makeCustomer(), settings, FIXED_NOW, {
        isCollaborative: true,
      }),
      null,
    );
  });

  it("falls back to lastValidFollowUpAt then createdAt when cycle is null", () => {
    const createdAt = daysAgoIso(20);
    const display = buildReclamationCountdownDisplay(
      makeCustomer({
        reclamationCycleStartedAt: null,
        lastValidFollowUpAt: null,
        createdAt,
      }),
      settings,
      FIXED_NOW,
    );
    assert.ok(display);
    assert.equal(display.daysRemaining, 25);
    assert.equal(
      display.reclaimAt,
      getProjectedReclaimAt(createdAt, settings.automaticReclaimDays),
    );
  });

  it("uses updated automaticReclaimDays from settings", () => {
    const display = buildReclamationCountdownDisplay(
      makeCustomer({
        lastValidFollowUpAt: daysAgoIso(10),
        reclamationCycleStartedAt: daysAgoIso(10),
      }),
      { automaticReclaimDays: 14 },
      FIXED_NOW,
    );
    assert.equal(display?.daysRemaining, 4);
    assert.equal(display?.reclaimDays, 14);
    assert.equal(display?.state, "high_risk");
  });

  it("does not expose negative daysRemaining", () => {
    const display = buildReclamationCountdownDisplay(
      makeCustomer({
        lastValidFollowUpAt: daysAgoIso(100),
        reclamationCycleStartedAt: daysAgoIso(100),
      }),
      settings,
      FIXED_NOW,
    );
    assert.equal(display?.state, "due");
    assert.equal(display?.daysRemaining, null);
  });
});

describe("countdown badge visuals", () => {
  it("maps states to badge variants without flashing styles", () => {
    assert.equal(getReclamationCountdownBadgeVariant("normal"), "default");
    assert.equal(getReclamationCountdownBadgeVariant("warning"), "warning");
    assert.equal(getReclamationCountdownBadgeVariant("high_risk"), "default");
    assert.equal(getReclamationCountdownBadgeVariant("urgent"), "danger");
    assert.equal(getReclamationCountdownBadgeVariant("due"), "danger");
    assert.equal(getReclamationCountdownBadgeVariant("grace"), "accent");
    assert.ok(getReclamationCountdownBadgeClassName("high_risk")?.includes("orange"));
    assert.equal(getReclamationCountdownBadgeClassName("warning"), undefined);
  });
});
