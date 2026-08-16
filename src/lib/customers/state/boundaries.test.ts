/**
 * TASK 17-C1 — Y-2 exact boundaries, Y-14 timezone semantics,
 * R1-J legacy alias boundaries, and the TASK 17-B-R2 §D calendar-derived
 * `stageDueAt` / `effectiveDueAt` boundary tests.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDaysWithoutValidFollowUp } from "@/lib/reclamation/days";
import type { Customer } from "../../../../drizzle/schema/customers";
import { computeCustomerState } from "./engine";
import { DEFAULT_CUSTOMER_STATE_RULES, DEFAULT_STAGE_SLA_RULES } from "./rules";
import { ACTIVE_SLA_STAGES } from "./stages";
import { computeStageDueAt, getStateCalendarDayDifference } from "./time";
import {
  NOW,
  hkDaysAgoIso,
  hkInstant,
  hoursAgoIso,
  msAgoIso,
  stateFacts,
} from "./state-fixtures.test-helper";

const MS_PER_HOUR = 3_600_000;

function evaluate(facts: Parameters<typeof computeCustomerState>[0], now = NOW) {
  return computeCustomerState(facts, DEFAULT_CUSTOMER_STATE_RULES, now);
}

describe("Y-2 — First Contact elapsed-hour boundaries (RULE H-4, R-C)", () => {
  const cases = [
    { label: "0h", createdAt: hoursAgoIso(0), expected: "normal" },
    { label: "23.9h", createdAt: msAgoIso(24 * MS_PER_HOUR - 1), expected: "normal" },
    { label: "exactly 24.000h", createdAt: hoursAgoIso(24), expected: "normal" },
    { label: "24h + 1ms", createdAt: msAgoIso(24 * MS_PER_HOUR + 1), expected: "due_soon" },
    { label: "exactly 48.000h", createdAt: hoursAgoIso(48), expected: "due_soon" },
    { label: "48h + 1ms", createdAt: msAgoIso(48 * MS_PER_HOUR + 1), expected: "overdue" },
    { label: "exactly 72.000h", createdAt: hoursAgoIso(72), expected: "overdue" },
    { label: "72h + 1ms", createdAt: msAgoIso(72 * MS_PER_HOUR + 1), expected: "critical" },
  ] as const;

  for (const testCase of cases) {
    it(`${testCase.label} → ${testCase.expected}`, () => {
      const state = evaluate(stateFacts({ createdAt: testCase.createdAt }));
      assert.equal(state.firstContact.state, testCase.expected);
    });
  }

  it("is timezone-independent — UTC settings give the same bands", () => {
    const createdAt = msAgoIso(48 * MS_PER_HOUR + 1);
    assert.equal(
      evaluate(stateFacts({ createdAt, businessTimezone: "UTC" })).firstContact
        .state,
      "overdue",
    );
    assert.equal(
      evaluate(stateFacts({ createdAt })).firstContact.state,
      "overdue",
    );
  });

  it("reports fractional ageHours without rounding", () => {
    const state = evaluate(
      stateFacts({ createdAt: msAgoIso(36 * MS_PER_HOUR + 1_800_000) }),
    );
    assert.equal(state.firstContact.ageHours, 36.5);
  });
});

describe("Y-2 — stage cadence boundaries for all five active stages", () => {
  for (const stage of ACTIVE_SLA_STAGES) {
    const { targetDays, warningDays, overdueDays, severeDays } =
      DEFAULT_STAGE_SLA_RULES[stage];

    // Every named threshold edge, derived from the locked table rather than
    // restated, so an accidental threshold change fails here too. Degenerate
    // probes (e.g. `warningDays - 1` when Warning is Target + 1) are dropped.
    const probes = [
      targetDays - 1,
      targetDays,
      targetDays + 1,
      warningDays - 1,
      warningDays,
      overdueDays - 1,
      overdueDays,
      severeDays - 1,
      severeDays,
      severeDays + 1,
    ].filter((days, index, all) => days >= 1 && all.indexOf(days) === index);

    const expectations = probes.map((days) => ({
      days,
      sla:
        days >= severeDays
          ? "severe_overdue"
          : days >= overdueDays
            ? "overdue"
            : days > targetDays
              ? "due_soon"
              : "on_track",
      engagement:
        days >= severeDays
          ? "silent"
          : days >= overdueDays
            ? "cooling"
            : days > targetDays
              ? "stable"
              : "active",
      warningReached:
        days >= warningDays && days > targetDays && days < overdueDays,
    }));

    for (const expectation of expectations) {
      it(`${stage} at ${expectation.days}d → SLA ${expectation.sla} / Engagement ${expectation.engagement}`, () => {
        const state = evaluate(
          stateFacts({
            salesStage: stage,
            lastValidFollowUpAt: hkDaysAgoIso(expectation.days),
            // Keep the reclamation clock out of the way; this test isolates cadence.
            reclamationCycleStartedAt: hkDaysAgoIso(0),
          }),
        );
        assert.equal(
          state.followUpSla.daysSinceValidInteraction,
          expectation.days,
          "daysSinceValidInteraction",
        );
        assert.equal(state.followUpSla.state, expectation.sla, "SLA");
        assert.equal(
          state.engagementHealth.state,
          expectation.engagement,
          "Engagement",
        );
        const codes = state.reasons.map((entry) => entry.code);
        assert.equal(
          codes.includes("SLA_WARNING_REACHED"),
          expectation.warningReached,
          "SLA_WARNING_REACHED",
        );
      });
    }
  }

  it("locks the specified stage table values", () => {
    assert.deepEqual(DEFAULT_STAGE_SLA_RULES, {
      new_lead: { targetDays: 2, warningDays: 3, overdueDays: 5, severeDays: 10 },
      contacted: { targetDays: 5, warningDays: 7, overdueDays: 10, severeDays: 21 },
      interested: { targetDays: 5, warningDays: 7, overdueDays: 14, severeDays: 28 },
      proposal: { targetDays: 3, warningDays: 5, overdueDays: 10, severeDays: 21 },
      negotiation: { targetDays: 3, warningDays: 5, overdueDays: 7, severeDays: 14 },
    });
  });
});

describe("R1-J — legacy stage aliases and negotiation boundaries", () => {
  const cases = [
    { days: 6, sla: "due_soon", engagement: "stable", churn: "low" },
    { days: 7, sla: "overdue", engagement: "cooling", churn: "medium" },
    { days: 8, sla: "overdue", engagement: "cooling", churn: "medium" },
    { days: 13, sla: "overdue", engagement: "cooling", churn: "medium" },
    { days: 14, sla: "severe_overdue", engagement: "silent", churn: "medium" },
  ] as const;

  for (const testCase of cases) {
    it(`negotiating at ${testCase.days}d behaves exactly as negotiation`, () => {
      const aliased = evaluate(
        stateFacts({
          salesStage: "negotiating",
          lastValidFollowUpAt: hkDaysAgoIso(testCase.days),
        }),
      );
      const canonical = evaluate(
        stateFacts({
          salesStage: "negotiation",
          lastValidFollowUpAt: hkDaysAgoIso(testCase.days),
        }),
      );
      assert.equal(aliased.followUpSla.state, testCase.sla);
      assert.equal(aliased.engagementHealth.state, testCase.engagement);
      assert.equal(aliased.churnRisk.level, testCase.churn);
      assert.deepEqual(aliased, canonical);
      assert.ok(
        !aliased.reasons.some((entry) => entry.code === "STATE_STAGE_UNKNOWN"),
      );
    });
  }

  it("negotiating at 8d gives overdue / cooling / medium / high (R1 scenario 66)", () => {
    const state = evaluate(
      stateFacts({
        salesStage: "negotiating",
        lastValidFollowUpAt: hkDaysAgoIso(8),
      }),
    );
    assert.equal(state.followUpSla.state, "overdue");
    assert.equal(state.engagementHealth.state, "cooling");
    assert.equal(state.churnRisk.level, "medium");
    assert.equal(state.attentionLevel.level, "high");
  });

  it("maps converted → closed_won", () => {
    const aliased = evaluate(
      stateFacts({ salesStage: "converted", lastValidFollowUpAt: hkDaysAgoIso(60) }),
    );
    const canonical = evaluate(
      stateFacts({ salesStage: "closed_won", lastValidFollowUpAt: hkDaysAgoIso(60) }),
    );
    assert.equal(aliased.followUpSla.state, "exempt");
    assert.equal(aliased.firstContact.cause, "post_sale");
    assert.deepEqual(aliased, canonical);
  });

  it("maps lost → closed_lost", () => {
    const aliased = evaluate(
      stateFacts({ salesStage: "lost", lastValidFollowUpAt: hkDaysAgoIso(40) }),
    );
    const canonical = evaluate(
      stateFacts({ salesStage: "closed_lost", lastValidFollowUpAt: hkDaysAgoIso(40) }),
    );
    assert.equal(aliased.firstContact.cause, "closed_lost");
    assert.deepEqual(aliased, canonical);
  });
});

describe("R2 §D — stageDueAt / effectiveDueAt Hong Kong boundaries", () => {
  // Normative example: valid interaction 2026-08-01 15:00 HK, Target 5 days.
  const validInteraction = hkInstant(2026, 8, 1, 15);
  const contactedFacts = (overrides: { now: Date; nextFollowUpAt?: string | null }) =>
    stateFacts({
      salesStage: "contacted",
      lastValidFollowUpAt: validInteraction.toISOString(),
      nextFollowUpAt: overrides.nextFollowUpAt ?? null,
      reclamationCycleStartedAt: overrides.now.toISOString(),
    });

  it("computes stageDueAt as 2026-08-07 00:00 HK (2026-08-06T16:00:00Z)", () => {
    assert.equal(
      computeStageDueAt(validInteraction, 5, "Asia/Hong_Kong").toISOString(),
      "2026-08-06T16:00:00.000Z",
    );
  });

  it("is the FIRST instant where calendar difference exceeds Target", () => {
    const dueAt = computeStageDueAt(validInteraction, 5, "Asia/Hong_Kong");
    assert.equal(
      getStateCalendarDayDifference(
        validInteraction,
        new Date(dueAt.getTime() - 1),
        "Asia/Hong_Kong",
      ),
      5,
    );
    assert.equal(
      getStateCalendarDayDifference(validInteraction, dueAt, "Asia/Hong_Kong"),
      6,
    );
  });

  it("stays on_track at 2026-08-06 23:59:59.999 HK", () => {
    const now = hkInstant(2026, 8, 6, 23, 59, 59, 999);
    const state = evaluate(contactedFacts({ now }), now);
    assert.equal(state.followUpSla.state, "on_track");
    assert.equal(state.followUpSla.daysSinceValidInteraction, 5);
    assert.equal(state.followUpSla.stageDueAt, "2026-08-06T16:00:00.000Z");
    assert.equal(state.followUpSla.effectiveDueAt, "2026-08-06T16:00:00.000Z");
  });

  it("becomes due_soon at 2026-08-07 00:00 HK", () => {
    const now = hkInstant(2026, 8, 7, 0);
    const state = evaluate(contactedFacts({ now }), now);
    assert.equal(state.followUpSla.state, "due_soon");
    assert.equal(state.followUpSla.daysSinceValidInteraction, 6);
  });

  it("takes an earlier parseable next action as effectiveDueAt", () => {
    const now = hkInstant(2026, 8, 4, 12);
    const nextFollowUpAt = hkInstant(2026, 8, 5, 10).toISOString();
    const state = evaluate(contactedFacts({ now, nextFollowUpAt }), now);
    assert.equal(state.followUpSla.stageDueAt, "2026-08-06T16:00:00.000Z");
    assert.equal(state.followUpSla.effectiveDueAt, nextFollowUpAt);
    assert.equal(state.followUpSla.state, "on_track");
  });

  it("cannot be extended by a later next action", () => {
    const now = hkInstant(2026, 8, 4, 12);
    const nextFollowUpAt = hkInstant(2026, 8, 10, 10).toISOString();
    const state = evaluate(contactedFacts({ now, nextFollowUpAt }), now);
    assert.equal(state.followUpSla.effectiveDueAt, "2026-08-06T16:00:00.000Z");
  });

  it("ignores a malformed next action for due-date computation", () => {
    const now = hkInstant(2026, 8, 4, 12);
    const state = evaluate(
      contactedFacts({ now, nextFollowUpAt: "not-a-date" }),
      now,
    );
    assert.equal(state.followUpSla.effectiveDueAt, "2026-08-06T16:00:00.000Z");
  });

  it("produces due_soon once an earlier next action has passed", () => {
    const now = hkInstant(2026, 8, 5, 11);
    const nextFollowUpAt = hkInstant(2026, 8, 5, 10).toISOString();
    const state = evaluate(contactedFacts({ now, nextFollowUpAt }), now);
    assert.equal(state.followUpSla.state, "due_soon");
    assert.ok(
      state.reasons.some((entry) => entry.code === "SLA_NEXT_ACTION_OVERDUE"),
    );
  });

  it("treats nextFollowUpAt == now as not overdue (strict <, RULE R-C)", () => {
    const now = hkInstant(2026, 8, 5, 10);
    const state = evaluate(
      contactedFacts({ now, nextFollowUpAt: now.toISOString() }),
      now,
    );
    assert.equal(state.followUpSla.state, "on_track");
    assert.ok(
      !state.reasons.some((entry) => entry.code === "SLA_NEXT_ACTION_OVERDUE"),
    );
  });

  it("returns null due dates for not_started, deferred, and exempt", () => {
    const nextFollowUpAt = hkDaysAgoIso(-3);
    for (const facts of [
      stateFacts({ salesStage: "contacted", nextFollowUpAt }),
      stateFacts({
        salesStage: "on_hold",
        lastValidFollowUpAt: hkDaysAgoIso(4),
        nextFollowUpAt,
      }),
      stateFacts({
        salesStage: "closed_lost",
        lastValidFollowUpAt: hkDaysAgoIso(4),
        nextFollowUpAt,
      }),
      stateFacts({
        salesStage: "foo",
        lastValidFollowUpAt: hkDaysAgoIso(4),
        nextFollowUpAt,
      }),
    ]) {
      const state = evaluate(facts);
      assert.ok(
        ["not_started", "deferred", "exempt"].includes(state.followUpSla.state),
      );
      assert.equal(state.followUpSla.stageDueAt, null);
      assert.equal(state.followUpSla.effectiveDueAt, null);
    }
  });
});

describe("Y-14 — timezone semantics (RULE R-B, R-E)", () => {
  it("resolves calendar days in the configured business timezone", () => {
    // 2026-08-10 23:00 UTC is already 2026-08-11 07:00 in Hong Kong.
    const lastValid = new Date("2026-08-10T23:00:00.000Z");
    const now = new Date("2026-08-16T01:00:00.000Z");
    assert.equal(
      getStateCalendarDayDifference(lastValid, now, "Asia/Hong_Kong"),
      5,
    );
    assert.equal(getStateCalendarDayDifference(lastValid, now, "UTC"), 6);
  });

  it("changes the SLA band when the settings timezone changes", () => {
    const lastValid = new Date("2026-08-10T23:00:00.000Z");
    const now = new Date("2026-08-16T01:00:00.000Z");
    const hk = computeCustomerState(
      stateFacts({
        salesStage: "contacted",
        lastValidFollowUpAt: lastValid.toISOString(),
      }),
      DEFAULT_CUSTOMER_STATE_RULES,
      now,
    );
    const utc = computeCustomerState(
      stateFacts({
        salesStage: "contacted",
        lastValidFollowUpAt: lastValid.toISOString(),
        businessTimezone: "UTC",
      }),
      DEFAULT_CUSTOMER_STATE_RULES,
      now,
    );
    assert.equal(hk.followUpSla.daysSinceValidInteraction, 5);
    assert.equal(hk.followUpSla.state, "on_track");
    assert.equal(utc.followUpSla.daysSinceValidInteraction, 6);
    assert.equal(utc.followUpSla.state, "due_soon");
  });

  it("agrees with reclamation/days.ts while business_timezone is Asia/Hong_Kong", () => {
    const now = new Date("2026-08-16T01:00:00.000Z");
    for (const anchor of [
      "2026-08-10T23:00:00.000Z",
      "2026-08-15T15:59:59.999Z",
      "2026-08-15T16:00:00.000Z",
      "2026-06-24T02:00:00.000Z",
    ]) {
      const customer = {
        reclamationCycleStartedAt: anchor,
        lastValidFollowUpAt: null,
        createdAt: anchor,
      } as Customer;
      assert.equal(
        getStateCalendarDayDifference(new Date(anchor), now, "Asia/Hong_Kong"),
        getDaysWithoutValidFollowUp(customer, now),
        anchor,
      );
    }
  });

  it("reports reclamation idleDays from the frozen helper", () => {
    const state = evaluate(
      stateFacts({
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(49),
      }),
    );
    assert.equal(state.reclamationRisk.idleDays, 49);
    assert.equal(state.reclamationRisk.daysRemaining, 6);
    assert.equal(state.reclamationRisk.state, "warning");
  });
});
