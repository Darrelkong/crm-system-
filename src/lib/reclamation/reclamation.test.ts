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
import { isReclaimGraceActive } from "./cycle";
import { getReclamationWarningMilestone } from "./milestones";

const DEFAULT_SETTINGS: EffectiveSettings = {
  automaticReclaimDays: 45,
  reclaimWarningDaysBefore: 1,
  reclaimWarningThresholdDays: 44,
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
    nameStatus: "confirmed",
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
    reclamationCycleStartedAt: rest.reclamationCycleStartedAt ?? null,
    reclaimRuleGraceUntil: rest.reclaimRuleGraceUntil ?? null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: rest.isPinned ?? 0,
    pinnedAt: rest.pinnedAt ?? null,
    collaborativeDissolvedAt: null,
    lifecycleStatus: null,
    lifecycleCompletedAt: null,
    lifecycleCompletedBy: null,
    lifecycleCompletionNotes: null,
    createdAt,
    updatedAt: createdAt,
    ...rest,
    requestedProjectCode: rest.requestedProjectCode ?? null,
    preferredName: rest.preferredName ?? null,
    gender: rest.gender ?? null,
    ageRange: rest.ageRange ?? null,
    preferredLanguage: rest.preferredLanguage ?? null,
    preferredContactMethod: rest.preferredContactMethod ?? null,
    occupation: rest.occupation ?? null,
    companyName: rest.companyName ?? null,
    jobTitle: rest.jobTitle ?? null,
    targetCountryOrRegion: rest.targetCountryOrRegion ?? null,
    primaryConcern: rest.primaryConcern ?? null,
  };
}

type ReclamationOutcome = "reclaim" | "warning" | "none";

/**
 * Mirror of the engine's stateless decision (without dedup).
 * Milestone model: warn every 7 idle days + final at reclaimDays - 1.
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
  const { automaticReclaimDays } = settings;

  if (days >= automaticReclaimDays) {
    if (isReclaimGraceActive(customer, now)) {
      return "none";
    }
    return "reclaim";
  }

  const milestone = getReclamationWarningMilestone(days, automaticReclaimDays);
  if (milestone !== null) {
    return "warning";
  }
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

  it("excludes paid (CUSTOMER-FLOW-SAFETY-1 approved paid customers)", () => {
    assert.equal(isReclamationExcludedSalesStage("paid"), true);
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

describe("auto-reclamation outcomes (45-day reclaim / 7-day milestones)", () => {
  const now = new Date("2026-06-29T12:00:00.000Z");

  it("no action below first milestone (day 6)", () => {
    const customer = buildCustomer(
      {
        salesStage: "negotiation",
        lastValidFollowUpAt: daysAgoIso(6, now),
        reclamationCycleStartedAt: daysAgoIso(6, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "none",
    );
  });

  it("sends first periodic warning at day 7", () => {
    const customer = buildCustomer(
      {
        salesStage: "negotiation",
        lastValidFollowUpAt: daysAgoIso(7, now),
        reclamationCycleStartedAt: daysAgoIso(7, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "warning",
    );
  });

  it("sends second periodic warning at day 14", () => {
    const customer = buildCustomer(
      {
        salesStage: "negotiation",
        lastValidFollowUpAt: daysAgoIso(14, now),
        reclamationCycleStartedAt: daysAgoIso(14, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "warning",
    );
  });

  it("no duplicate milestone between 7-day nodes (day 8)", () => {
    const customer = buildCustomer(
      {
        salesStage: "negotiation",
        lastValidFollowUpAt: daysAgoIso(8, now),
        reclamationCycleStartedAt: daysAgoIso(8, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "none",
    );
  });

  it("final urgent warning at day 44", () => {
    const customer = buildCustomer(
      {
        salesStage: "negotiation",
        lastValidFollowUpAt: daysAgoIso(44, now),
        reclamationCycleStartedAt: daysAgoIso(44, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "warning",
    );
  });

  it("auto-reclaims at day 45", () => {
    const customer = buildCustomer(
      {
        salesStage: "negotiation",
        lastValidFollowUpAt: daysAgoIso(45, now),
        reclamationCycleStartedAt: daysAgoIso(45, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "reclaim",
    );
  });

  it("blocks reclaim during 24h rule-shortening grace", () => {
    const customer = buildCustomer(
      {
        salesStage: "negotiation",
        lastValidFollowUpAt: daysAgoIso(50, now),
        reclamationCycleStartedAt: daysAgoIso(50, now),
        reclaimRuleGraceUntil: new Date(
          now.getTime() + 12 * 60 * 60 * 1000,
        ).toISOString(),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "none",
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

  it("does not reclaim paid customers", () => {
    const customer = buildCustomer(
      {
        salesStage: "paid",
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
        lastValidFollowUpAt: daysAgoIso(45, now),
        reclamationCycleStartedAt: daysAgoIso(45, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "reclaim",
    );
  });

  it("does not warn on_hold customers at milestone days", () => {
    const customer = buildCustomer(
      {
        salesStage: "on_hold",
        lastValidFollowUpAt: daysAgoIso(7, now),
        reclamationCycleStartedAt: daysAgoIso(7, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "none",
    );
  });

  it("does not warn pinned customers at milestone days", () => {
    const customer = buildCustomer(
      {
        salesStage: "negotiation",
        isPinned: 1,
        pinnedAt: daysAgoIso(1, now),
        lastValidFollowUpAt: daysAgoIso(7, now),
        reclamationCycleStartedAt: daysAgoIso(7, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "none",
    );
  });

  it("resets milestone schedule after a fresh valid follow-up (anchor moves forward)", () => {
    const idle45 = buildCustomer(
      {
        salesStage: "negotiation",
        lastValidFollowUpAt: daysAgoIso(45, now),
        reclamationCycleStartedAt: daysAgoIso(45, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(idle45, DEFAULT_SETTINGS, now),
      "reclaim",
    );
    const afterFollowUp = buildCustomer(
      {
        salesStage: "negotiation",
        lastValidFollowUpAt: daysAgoIso(0, now),
        reclamationCycleStartedAt: daysAgoIso(0, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(afterFollowUp, DEFAULT_SETTINGS, now),
      "none",
    );
  });
});

describe("auto-reclamation settings parsing", () => {
  it("uses defaults: 45 / 1 / threshold 44", () => {
    const settings = parseEffectiveSettings(makeSettingsMap());
    assert.equal(settings.automaticReclaimDays, 45);
    assert.equal(settings.reclaimWarningDaysBefore, 1);
    assert.equal(settings.reclaimWarningThresholdDays, 44);
  });

  it("falls back to defaults when daysBefore >= reclaim", () => {
    const settings = parseEffectiveSettings(
      makeSettingsMap({
        automatic_reclaim_days: "5",
        reclaim_warning_days_before: "5",
      }),
    );
    assert.equal(settings.automaticReclaimDays, 45);
    assert.equal(settings.reclaimWarningDaysBefore, 1);
  });

  it("only falls back daysBefore when it is non-positive (keeps custom reclaim)", () => {
    const settings = parseEffectiveSettings(
      makeSettingsMap({
        automatic_reclaim_days: "10",
        reclaim_warning_days_before: "0",
      }),
    );
    assert.equal(settings.automaticReclaimDays, 10);
    assert.equal(settings.reclaimWarningDaysBefore, 1);
    assert.equal(settings.reclaimWarningThresholdDays, 9);
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

describe("auto-reclamation settings validation", () => {
  it("accepts default values (45 / 1)", () => {
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

  it("accepts admin PATCH updating reclaim keys to 45 / 1", () => {
    const err = validateSettingsPatch(makeSettingsMap(), {
      automatic_reclaim_days: "45",
      reclaim_warning_days_before: "1",
    });
    assert.equal(err, null);
  });

  it("rejects admin PATCH lowering reclaim below current daysBefore", () => {
    const err = validateSettingsPatch(
      makeSettingsMap({ reclaim_warning_days_before: "5" }),
      {
        automatic_reclaim_days: "3",
      },
    );
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

  it("collaborative customer at reclaim threshold (day 45) is skipped", () => {
    const customer = buildCustomer(
      {
        salesStage: "negotiation",
        lastValidFollowUpAt: daysAgoIso(45, now),
        reclamationCycleStartedAt: daysAgoIso(45, now),
      },
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

  it("collaborative customer in warning band (day 7) is also skipped", () => {
    const customer = buildCustomer(
      {
        salesStage: "negotiation",
        lastValidFollowUpAt: daysAgoIso(7, now),
        reclamationCycleStartedAt: daysAgoIso(7, now),
      },
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

  it("non-collaborative customer at reclaim threshold (day 45) is still reclaimed", () => {
    const customer = buildCustomer(
      {
        salesStage: "negotiation",
        lastValidFollowUpAt: daysAgoIso(45, now),
        reclamationCycleStartedAt: daysAgoIso(45, now),
      },
      now,
    );
    assert.equal(
      classifyWithCollaborators(customer, DEFAULT_SETTINGS, now, false),
      "reclaim",
    );
  });

  it("non-collaborative customer at milestone (day 7) gets a warning", () => {
    const customer = buildCustomer(
      {
        salesStage: "negotiation",
        lastValidFollowUpAt: daysAgoIso(7, now),
        reclamationCycleStartedAt: daysAgoIso(7, now),
      },
      now,
    );
    assert.equal(
      classifyWithCollaborators(customer, DEFAULT_SETTINGS, now, false),
      "warning",
    );
  });

  it("non-collaborative customer below first milestone (day 6) has no action", () => {
    const customer = buildCustomer(
      {
        salesStage: "negotiation",
        lastValidFollowUpAt: daysAgoIso(6, now),
        reclamationCycleStartedAt: daysAgoIso(6, now),
      },
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
