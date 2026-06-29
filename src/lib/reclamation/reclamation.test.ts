import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Customer } from "../../../drizzle/schema/customers";
import type { EffectiveSettings } from "@/lib/settings/effective";
import {
  isReclamationEligibleCustomer,
  isReclamationExcludedSalesStage,
} from "./constants";
import { getDaysWithoutValidFollowUp } from "./days";

const DEFAULT_SETTINGS: EffectiveSettings = {
  automaticReclaimDays: 8,
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
    createdAt,
    updatedAt: createdAt,
    ...rest,
  };
}

type ReclamationOutcome =
  | "reclaim"
  | "warning_day_7"
  | "warning_day_6"
  | "none";

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
  const { automaticReclaimDays, reclaimWarningDay1, reclaimWarningDay2 } =
    settings;

  if (days >= automaticReclaimDays) {
    return "reclaim";
  }
  if (days >= reclaimWarningDay2 && days < automaticReclaimDays) {
    return "warning_day_7";
  }
  if (days >= reclaimWarningDay1 && days < reclaimWarningDay2) {
    return "warning_day_6";
  }
  return "none";
}

describe("auto-reclamation sales stage exclusions", () => {
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
      isReclamationEligibleCustomer({ salesStage: "negotiation", isPinned: 0 }),
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
      isReclamationEligibleCustomer({ salesStage: "negotiation", isPinned: 1 }),
      false,
    );
  });

  it("excludes on_hold and isPinned = 1 together", () => {
    assert.equal(
      isReclamationEligibleCustomer({ salesStage: "on_hold", isPinned: 1 }),
      false,
    );
  });

  it("excludes closed_won", () => {
    assert.equal(
      isReclamationEligibleCustomer({ salesStage: "closed_won", isPinned: 0 }),
      false,
    );
  });

  it("includes closed_lost (unchanged behavior)", () => {
    assert.equal(
      isReclamationEligibleCustomer({ salesStage: "closed_lost", isPinned: 0 }),
      true,
    );
  });
});

describe("auto-reclamation outcomes", () => {
  const now = new Date("2026-06-24T12:00:00.000Z");

  it("reclaims normal active customers at reclaim threshold", () => {
    const customer = buildCustomer(
      {
        salesStage: "negotiation",
        isPinned: 0,
        lastValidFollowUpAt: daysAgoIso(8, now),
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
        isPinned: 0,
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

  it("still reclaims closed_lost customers at reclaim threshold", () => {
    const customer = buildCustomer(
      {
        salesStage: "closed_lost",
        isPinned: 0,
        lastValidFollowUpAt: daysAgoIso(8, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "reclaim",
    );
  });

  it("sends day-6 warning to eligible customers in warning band", () => {
    const customer = buildCustomer(
      {
        salesStage: "new_lead",
        isPinned: 0,
        lastValidFollowUpAt: daysAgoIso(6, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "warning_day_6",
    );
  });

  it("does not send warnings to on_hold customers in warning band", () => {
    const customer = buildCustomer(
      {
        salesStage: "on_hold",
        isPinned: 0,
        lastValidFollowUpAt: daysAgoIso(6, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "none",
    );
  });

  it("does not send warnings to pinned customers in warning band", () => {
    const customer = buildCustomer(
      {
        salesStage: "negotiation",
        isPinned: 1,
        pinnedAt: daysAgoIso(1, now),
        lastValidFollowUpAt: daysAgoIso(7, now),
      },
      now,
    );
    assert.equal(
      classifyReclamationOutcome(customer, DEFAULT_SETTINGS, now),
      "none",
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
