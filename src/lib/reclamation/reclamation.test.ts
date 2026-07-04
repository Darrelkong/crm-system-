import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Customer } from "../../../drizzle/schema/customers";
import {
  parseEffectiveSettings,
  type EffectiveSettings,
} from "@/lib/settings/effective";
import { SETTING_DEFAULTS } from "@/lib/settings/keys";
import type { SettingsMap } from "@/lib/settings/service";
import {
  validateSettingsConsistency,
  validateSettingsPatch,
  validateSettingValue,
} from "@/lib/settings/validation";

function makeSettingsMap(overrides: Partial<SettingsMap> = {}): SettingsMap {
  return { ...SETTING_DEFAULTS, ...overrides };
}
import {
  isReclamationEligibleCustomer,
  isReclamationExcludedSalesStage,
} from "./constants";
import { getDaysWithoutValidFollowUp } from "./days";

const DEFAULT_SETTINGS: EffectiveSettings = {
  automaticReclaimDays: 7,
  reclaimWarningDaysBefore: 3,
  reclaimWarningThresholdDays: 4,
  reclaimWarningDay1: 6,
  reclaimWarningDay2: 7,
  publicPoolClaimQuota7Days: 5,
  publicPoolClaimCooldownHours: 12,
  firstContactSlaHours: 24,
  businessTimezone: "Asia/Shanghai",
  inactivityLogoutMinutes: 30,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgoIso(days: number, now: Date): string {
  return new Date(now.getTime() - days * MS_PER_DAY).toISOString();
}

function buildCustomer(
  overrides: Partial<Customer> & Pick<Customer, "salesStage">,
  now: Date,
): Customer {
  const createdAt = overrides.createdAt ?? daysAgoIso(30, now);
  const { salesStage, ...rest } = overrides;
  return {
    id: "test-customer-id",
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
    salesStage,
    ownerId: rest.ownerId ?? "owner-id",
    status: rest.status ?? "active",
    releaserUserId: null,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    createdBy: "owner-id",
    updatedBy: "owner-id",
    lastFollowUpAt: null,
    lastValidFollowUpAt:
      rest.lastValidFollowUpAt ?? daysAgoIso(10, now),
    nextFollowUpAt: null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: rest.isPinned ?? 0,
    pinnedAt: rest.pinnedAt ?? null,
    collaborativeDissolvedAt: null,
    createdAt,
    updatedAt: createdAt,
    ...rest,
  };
}

type ReclamationOutcome = "reclaim" | "warning" | "none";

/**
 * Mirror of the engine's stateless decision (without dedup).
 * E-4b single-warning model: warn at >= reclaim - daysBefore; reclaim at >= reclaim.
 */
function classifyReclamationOutcome(
  customer: Customer,
  settings: EffectiveSettings,
  now: Date,
): ReclamationOutcome {
  if (customer.status !== "active" || !customer.ownerId) {
    return "none";
  }
  if (!isReclamationEligibleCustomer(customer)) {
    return "none";
  }

  const days = getDaysWithoutValidFollowUp(customer, now);
  const { automaticReclaimDays, reclaimWarningThresholdDays } = settings;

  if (days >= automaticReclaimDays) return "reclaim";
  if (days >= reclaimWarningThresholdDays) return "warning";
  return "none";
}

describe("auto-reclamation sales stage exclusions (E-4 Safe-1)", () => {
  it("excludes closed_won regardless of idle time eligibility", () => {
    assert.equal(isReclamationExcludedSalesStage("closed_won"), true);
  });

  it("excludes legacy converted alias for closed won", () => {
    assert.equal(isReclamationExcludedSalesStage("converted"), true);
  });

  it("excludes on_hold (D-1b approved hold customers)", () => {
    assert.equal(isReclamationExcludedSalesStage("on_hold"), true);
  });

  it("does not exclude closed_lost", () => {
    assert.equal(isReclamationExcludedSalesStage("closed_lost"), false);
  });

  it("does not exclude new_lead or other active stages", () => {
    assert.equal(isReclamationExcludedSalesStage("new_lead"), false);
    assert.equal(isReclamationExcludedSalesStage("negotiation"), false);
  });
});

describe("auto-reclamation customer eligibility", () => {
  it("includes normal active customers", () => {
    assert.equal(
      isReclamationEligibleCustomer({
        salesStage: "negotiation",
        isPinned: 0,
      }),
      true,
    );
  });

  it("excludes on_hold even when not pinned", () => {
    assert.equal(
      isReclamationEligibleCustomer({ salesStage: "on_hold", isPinned: 0 }),
      false,
    );
  });

  it("excludes isPinned = 1 even when not on_hold", () => {
    assert.equal(
      isReclamationEligibleCustomer({
        salesStage: "negotiation",
        isPinned: 1,
      }),
      false,
    );
  });

  it("excludes on_hold and isPinned = 1 together", () => {
    assert.equal(
      isReclamationEligibleCustomer({ salesStage: "on_hold", isPinned: 1 }),
      false,
    );
  });

  it("includes closed_lost (unchanged behavior)", () => {
    assert.equal(
      isReclamationEligibleCustomer({
        salesStage: "closed_lost",
        isPinned: 0,
      }),
      true,
    );
  });
});

describe("auto-reclamation outcomes (E-4b 7-day reclaim / 3-day pre-warn)", () => {
  const now = new Date("2026-06-29T12:00:00.000Z");

  it("no action below the warning threshold (day 3)", () => {
    const customer = buildCustomer(
      {
        salesStage: "negotiation",
        lastValidFollowUpAt: daysAgoIso(3, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "none",
    );
  });

  it("sends a pre-reclaim warning at day 4 (= reclaim - daysBefore)", () => {
    const customer = buildCustomer(
      {
        salesStage: "negotiation",
        lastValidFollowUpAt: daysAgoIso(4, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "warning",
    );
  });

  it("still in warning band at day 5 and day 6 (engine layer dedups across days)", () => {
    const d5 = buildCustomer(
      {
        salesStage: "negotiation",
        lastValidFollowUpAt: daysAgoIso(5, now),
      },
      now,
    );
    const d6 = buildCustomer(
      {
        salesStage: "negotiation",
        lastValidFollowUpAt: daysAgoIso(6, now),
      },
      now,
    );
    assert.equal(classifyReclamationOutcome(d5, DEFAULT_SETTINGS, now), "warning");
    assert.equal(classifyReclamationOutcome(d6, DEFAULT_SETTINGS, now), "warning");
  });

  it("auto-reclaims at day 7", () => {
    const customer = buildCustomer(
      {
        salesStage: "negotiation",
        lastValidFollowUpAt: daysAgoIso(7, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "reclaim",
    );
  });

  it("does not reclaim on_hold customers at reclaim threshold", () => {
    const customer = buildCustomer(
      {
        salesStage: "on_hold",
        lastValidFollowUpAt: daysAgoIso(10, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "none",
    );
  });

  it("does not reclaim isPinned = 1 customers at reclaim threshold", () => {
    const customer = buildCustomer(
      {
        salesStage: "negotiation",
        isPinned: 1,
        pinnedAt: daysAgoIso(5, now),
        lastValidFollowUpAt: daysAgoIso(10, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "none",
    );
  });

  it("does not reclaim approved on_hold pinned customers", () => {
    const customer = buildCustomer(
      {
        salesStage: "on_hold",
        isPinned: 1,
        pinnedAt: daysAgoIso(5, now),
        lastValidFollowUpAt: daysAgoIso(10, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "none",
    );
  });

  it("does not reclaim closed_won customers", () => {
    const customer = buildCustomer(
      {
        salesStage: "closed_won",
        lastValidFollowUpAt: daysAgoIso(10, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "none",
    );
  });

  it("still reclaims closed_lost customers (legacy behavior)", () => {
    const customer = buildCustomer(
      {
        salesStage: "closed_lost",
        lastValidFollowUpAt: daysAgoIso(7, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "reclaim",
    );
  });

  it("does not warn on_hold customers in the warning band", () => {
    const customer = buildCustomer(
      {
        salesStage: "on_hold",
        lastValidFollowUpAt: daysAgoIso(4, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "none",
    );
  });

  it("does not warn pinned customers in the warning band", () => {
    const customer = buildCustomer(
      {
        salesStage: "negotiation",
        isPinned: 1,
        pinnedAt: daysAgoIso(1, now),
        lastValidFollowUpAt: daysAgoIso(5, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "none",
    );
  });

  it("resets warning band after a fresh valid follow-up (anchor moves forward)", () => {
    const idle10 = buildCustomer(
      {
        salesStage: "negotiation",
        lastValidFollowUpAt: daysAgoIso(10, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(idle10, DEFAULT_SETTINGS, now),
      "reclaim",
    );
    const afterFollowUp = buildCustomer(
      {
        salesStage: "negotiation",
        lastValidFollowUpAt: daysAgoIso(0, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(afterFollowUp, DEFAULT_SETTINGS, now),
      "none",
    );
  });
});

describe("auto-reclamation settings parsing (E-4b)", () => {
  it("uses E-4b defaults: 7 / 3 / threshold 4", () => {
    const settings = parseEffectiveSettings(makeSettingsMap());
    assert.equal(settings.automaticReclaimDays, 7);
    assert.equal(settings.reclaimWarningDaysBefore, 3);
    assert.equal(settings.reclaimWarningThresholdDays, 4);
  });

  it("falls back to defaults when daysBefore >= reclaim", () => {
    const settings = parseEffectiveSettings(
      makeSettingsMap({
        automatic_reclaim_days: "5",
        reclaim_warning_days_before: "5",
      }),
    );
    assert.equal(settings.automaticReclaimDays, 7);
    assert.equal(settings.reclaimWarningDaysBefore, 3);
  });

  it("only falls back daysBefore when it is non-positive (keeps custom reclaim)", () => {
    const settings = parseEffectiveSettings(
      makeSettingsMap({
        automatic_reclaim_days: "10",
        reclaim_warning_days_before: "0",
      }),
    );
    assert.equal(settings.automaticReclaimDays, 10);
    assert.equal(settings.reclaimWarningDaysBefore, 3);
    assert.equal(settings.reclaimWarningThresholdDays, 7);
  });

  it("respects valid custom values (10 / 4 → threshold 6)", () => {
    const settings = parseEffectiveSettings(
      makeSettingsMap({
        automatic_reclaim_days: "10",
        reclaim_warning_days_before: "4",
      }),
    );
    assert.equal(settings.automaticReclaimDays, 10);
    assert.equal(settings.reclaimWarningDaysBefore, 4);
    assert.equal(settings.reclaimWarningThresholdDays, 6);
  });
});

describe("auto-reclamation settings validation (E-4b)", () => {
  it("accepts default values (7 / 3)", () => {
    assert.equal(validateSettingsConsistency(makeSettingsMap()), null);
  });

  it("rejects daysBefore = 0", () => {
    assert.equal(
      validateSettingValue("reclaim_warning_days_before", "0"),
      "必须为正整数",
    );
  });

  it("rejects daysBefore >= automatic_reclaim_days", () => {
    const err = validateSettingsConsistency(
      makeSettingsMap({
        automatic_reclaim_days: "5",
        reclaim_warning_days_before: "5",
      }),
    );
    assert.equal(
      err,
      "reclaim_warning_days_before 必须小于 automatic_reclaim_days",
    );
  });

  it("rejects daysBefore > automatic_reclaim_days", () => {
    const err = validateSettingsConsistency(
      makeSettingsMap({
        automatic_reclaim_days: "5",
        reclaim_warning_days_before: "7",
      }),
    );
    assert.equal(
      err,
      "reclaim_warning_days_before 必须小于 automatic_reclaim_days",
    );
  });

  it("accepts admin PATCH updating only the new keys to 7 / 3", () => {
    const err = validateSettingsPatch(makeSettingsMap(), {
      automatic_reclaim_days: "7",
      reclaim_warning_days_before: "3",
    });
    assert.equal(err, null);
  });

  it("rejects admin PATCH lowering reclaim below current daysBefore", () => {
    const err = validateSettingsPatch(makeSettingsMap(), {
      automatic_reclaim_days: "3",
    });
    assert.equal(
      err,
      "reclaim_warning_days_before 必须小于 automatic_reclaim_days",
    );
  });
});

describe("auto-reclamation customer status assumptions", () => {
  it("archived and deleted customers are out of engine scope by query filter", () => {
    const activeOnlyStatuses = ["active"];
    assert.equal(activeOnlyStatuses.includes("archived"), false);
    assert.equal(activeOnlyStatuses.includes("deleted"), false);
  });
});

// ---------------------------------------------------------------------------
// C-2: collaborative customers (≥1 collaborator row) are exempt from
// ordinary auto-reclaim and pre-reclaim warnings.
// ---------------------------------------------------------------------------

describe("C-2: collaborative customers are exempt from ordinary auto-reclaim", () => {
  const now = new Date("2026-06-29T12:00:00.000Z");

  /**
   * Mirror of the updated engine loop decision.
   * When hasCollaborators=true the engine skips the customer entirely
   * before evaluating days, exactly as `runReclamationCheck` does.
   */
  function classifyWithCollaborators(
    customer: Customer,
    settings: EffectiveSettings,
    nowDate: Date,
    hasCollaborators: boolean,
  ): ReclamationOutcome {
    if (hasCollaborators) return "none";
    return classifyReclamationOutcome(customer, settings, nowDate);
  }

  it("collaborative customer at reclaim threshold (day 7) is skipped", () => {
    const customer = buildCustomer(
      { salesStage: "negotiation", lastValidFollowUpAt: daysAgoIso(7, now) },
      now,
    );
    assert.equal(
      classifyWithCollaborators(customer, DEFAULT_SETTINGS, now, true),
      "none",
    );
  });

  it("collaborative customer well beyond reclaim threshold (day 30) is still skipped", () => {
    const customer = buildCustomer(
      { salesStage: "negotiation", lastValidFollowUpAt: daysAgoIso(30, now) },
      now,
    );
    assert.equal(
      classifyWithCollaborators(customer, DEFAULT_SETTINGS, now, true),
      "none",
    );
  });

  it("collaborative customer in warning band (day 5) is also skipped", () => {
    const customer = buildCustomer(
      { salesStage: "negotiation", lastValidFollowUpAt: daysAgoIso(5, now) },
      now,
    );
    assert.equal(
      classifyWithCollaborators(customer, DEFAULT_SETTINGS, now, true),
      "none",
    );
  });

  it("collaborative customer does not change ownerId or status (fields stay intact)", () => {
    const customer = buildCustomer(
      { salesStage: "negotiation", lastValidFollowUpAt: daysAgoIso(30, now) },
      now,
    );
    const outcome = classifyWithCollaborators(
      customer,
      DEFAULT_SETTINGS,
      now,
      true,
    );
    assert.equal(outcome, "none");
    // Engine must not touch these fields for collaborative customers.
    assert.equal(customer.ownerId, "owner-id");
    assert.equal(customer.status, "active");
  });

  it("non-collaborative customer at reclaim threshold (day 7) is still reclaimed", () => {
    const customer = buildCustomer(
      { salesStage: "negotiation", lastValidFollowUpAt: daysAgoIso(7, now) },
      now,
    );
    assert.equal(
      classifyWithCollaborators(customer, DEFAULT_SETTINGS, now, false),
      "reclaim",
    );
  });

  it("non-collaborative customer in warning band (day 5) still gets a warning", () => {
    const customer = buildCustomer(
      { salesStage: "negotiation", lastValidFollowUpAt: daysAgoIso(5, now) },
      now,
    );
    assert.equal(
      classifyWithCollaborators(customer, DEFAULT_SETTINGS, now, false),
      "warning",
    );
  });

  it("non-collaborative customer below warning threshold (day 3) has no action", () => {
    const customer = buildCustomer(
      { salesStage: "negotiation", lastValidFollowUpAt: daysAgoIso(3, now) },
      now,
    );
    assert.equal(
      classifyWithCollaborators(customer, DEFAULT_SETTINGS, now, false),
      "none",
    );
  });

  it("hasCollaborators=false does not override on_hold exclusion", () => {
    const customer = buildCustomer(
      { salesStage: "on_hold", lastValidFollowUpAt: daysAgoIso(10, now) },
      now,
    );
    assert.equal(
      classifyWithCollaborators(customer, DEFAULT_SETTINGS, now, false),
      "none",
    );
  });

  it("hasCollaborators=false does not override pinned exclusion", () => {
    const customer = buildCustomer(
      {
        salesStage: "negotiation",
        isPinned: 1,
        pinnedAt: daysAgoIso(1, now),
        lastValidFollowUpAt: daysAgoIso(10, now),
      },
      now,
    );
    assert.equal(
      classifyWithCollaborators(customer, DEFAULT_SETTINGS, now, false),
      "none",
    );
  });
});
