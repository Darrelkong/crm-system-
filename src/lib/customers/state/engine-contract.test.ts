/**
 * TASK 17-C1 — engine contract coverage.
 *
 * Y-11    malformed timestamps (no throw, no NaN, no Invalid Date)
 * R1-F    pure-engine unknown-stage behaviour
 * R1-I    absence of DEFERRAL_ENDED
 * R2 §B   reason-code baseline-state matrix
 * R2 §C   malformed valid-interaction timestamp matrix
 * plus purity / one-injected-now, post-sale and closed_lost exclusion,
 * unowned / Public Pool, On Hold, Attention precedence, rule resolution,
 * and the closed reason-code registry.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { computeCustomerState } from "./engine";
import {
  CUSTOMER_STATE_DIMENSIONS,
  CUSTOMER_STATE_REASON_CODES,
  EXCLUSIVE_REASON_CODES,
  ACTION_ELIGIBLE_REASON_CODES,
  isCustomerStateReasonCode,
  type CustomerStateReasonCode,
} from "./reason-codes";
import {
  CUSTOMER_STATE_RULE_VERSION,
  DEFAULT_CUSTOMER_STATE_RULES,
  DEFAULT_STAGE_SLA_RULES,
  resolveCustomerStateRules,
} from "./rules";
import { CANONICAL_STAGES, normalizeSalesStage } from "./stages";
import { parseStateInstant } from "./time";
import type { CustomerState, CustomerStateFacts } from "./types";
import {
  NOW,
  completeProfile,
  coreProfile,
  emptyProfile,
  hkDaysAgoIso,
  hoursAgoIso,
  outcome,
  repeatOutcome,
  stateFacts,
} from "./state-fixtures.test-helper";

const STATE_DIR = "src/lib/customers/state";

function evaluate(facts: CustomerStateFacts, now = NOW): CustomerState {
  return computeCustomerState(facts, DEFAULT_CUSTOMER_STATE_RULES, now);
}

/** Every numeric field the contract exposes, for NaN sweeps. */
function numericFields(state: CustomerState): (number | null)[] {
  return [
    state.profileCompleteness.score,
    state.firstContact.ageHours,
    state.followUpSla.daysSinceValidInteraction,
    state.engagementHealth.daysSinceValidInteraction,
    state.reclamationRisk.idleDays,
    state.reclamationRisk.daysRemaining,
  ];
}

function assertWellFormed(state: CustomerState, label: string): void {
  for (const value of numericFields(state)) {
    assert.ok(
      value === null || Number.isFinite(value),
      `${label}: non-finite numeric ${value}`,
    );
  }
  for (const iso of [
    state.evaluatedAt,
    state.firstContact.anchorAt,
    state.followUpSla.stageDueAt,
    state.followUpSla.effectiveDueAt,
  ]) {
    if (iso === null) continue;
    assert.ok(!iso.includes("Invalid"), `${label}: ${iso}`);
    assert.equal(
      Number.isNaN(new Date(iso).getTime()),
      false,
      `${label}: unparseable ${iso}`,
    );
  }
  for (const entry of state.reasons) {
    assert.ok(isCustomerStateReasonCode(entry.code), entry.code);
    assert.ok(
      CUSTOMER_STATE_DIMENSIONS.includes(entry.dimension),
      entry.dimension,
    );
    for (const value of Object.values(entry.params ?? {})) {
      assert.ok(
        typeof value !== "number" || Number.isFinite(value),
        `${label}: non-finite param on ${entry.code}`,
      );
    }
  }
}

const INVALID_CALENDAR_TIMESTAMPS = [
  "2026-02-29T12:00:00Z",
  "2026-02-30T12:00:00Z",
  "2026-04-31T12:00:00Z",
  "2026-00-10T12:00:00Z",
  "2026-13-01T12:00:00Z",
  "2026-01-00T12:00:00Z",
  "2026-01-01T24:00:00Z",
  "2026-01-01T23:60:00Z",
  "2026-01-01T23:59:60Z",
] as const;

const MALFORMED_TIMESTAMPS = [
  "",
  "   ",
  "not-a-date",
  "0000-00-00",
  "2026-13-45T99:99:99Z",
  "16/08/2026",
  "Invalid Date",
  "NaN",
  "null",
  "undefined",
  "\u0000",
  ...INVALID_CALENDAR_TIMESTAMPS,
] as const;

describe("Y-11 — fixture premise: every entry is genuinely unparseable", () => {
  for (const value of MALFORMED_TIMESTAMPS) {
    it(`parseStateInstant(${JSON.stringify(value)}) is null`, () => {
      assert.equal(parseStateInstant(value), null);
    });
  }

  const validTimestamps = [
    {
      label: "valid leap-year February 29",
      value: "2024-02-29T23:59:59.999Z",
      expected: "2024-02-29T23:59:59.999Z",
    },
    {
      label: "valid January month end",
      value: "2026-01-31T23:59:59Z",
      expected: "2026-01-31T23:59:59.000Z",
    },
    {
      label: "valid April month end",
      value: "2026-04-30T23:59:59Z",
      expected: "2026-04-30T23:59:59.000Z",
    },
    {
      label: "timezone-offset instant",
      value: "2026-08-16T12:00:00+08:00",
      expected: "2026-08-16T04:00:00.000Z",
    },
    {
      label: "Z instant",
      value: "2026-08-16T12:00:00Z",
      expected: "2026-08-16T12:00:00.000Z",
    },
    {
      label: "intentional offset-less T form",
      value: "2026-08-16T12:00:00",
      expected: "2026-08-16T12:00:00.000Z",
    },
    {
      label: "intentional offset-less SQLite form",
      value: "2026-08-16 12:00:00",
      expected: "2026-08-16T12:00:00.000Z",
    },
  ] as const;

  for (const { label, value, expected } of validTimestamps) {
    it(`accepts ${label}`, () => {
      assert.equal(parseStateInstant(value)?.toISOString(), expected);
    });
  }

  it("rejects every impossible calendar/time value instead of rolling it over", () => {
    for (const value of INVALID_CALENDAR_TIMESTAMPS) {
      assert.equal(parseStateInstant(value), null, value);
    }
  });
});

describe("Y-11 — malformed timestamps never throw, NaN, or leak Invalid Date", () => {
  const timestampFields = [
    "createdAt",
    "lastValidFollowUpAt",
    "nextFollowUpAt",
    "reclamationCycleStartedAt",
    "reclaimRuleGraceUntil",
  ] as const;

  for (const field of timestampFields) {
    for (const value of MALFORMED_TIMESTAMPS) {
      it(`${field} = ${JSON.stringify(value)}`, () => {
        const state = evaluate(
          stateFacts({ salesStage: "contacted", [field]: value }),
        );
        assertWellFormed(state, `${field}=${value}`);
      });
    }
  }

  it("survives a malformed follow-up timestamp inside churn evidence", () => {
    for (const value of MALFORMED_TIMESTAMPS) {
      const state = evaluate(
        stateFacts({
          salesStage: "contacted",
          lastValidFollowUpAt: hkDaysAgoIso(4),
          followUpOutcomes: [
            outcome("no_contact", value),
            outcome("no_contact", value),
            outcome("no_contact", value),
            outcome("lost_contact", value),
          ],
        }),
      );
      assertWellFormed(state, `followUpTime=${value}`);
      // An undatable record cannot be placed in the window or after the
      // valid interaction, so it is not evidence.
      assert.deepEqual(state.churnRisk.families, [], value);
      assert.equal(state.churnRisk.level, "low");
    }
  });

  it("survives a null follow-up timestamp", () => {
    const state = evaluate(
      stateFacts({
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(4),
        followUpOutcomes: [
          outcome("no_reply", null),
          outcome("no_reply", null),
          outcome("not_interested", null),
        ],
      }),
    );
    assertWellFormed(state, "followUpTime=null");
    assert.deepEqual(state.churnRisk.families, []);
  });

  it("survives an unrecognised outcome string", () => {
    const state = evaluate(
      stateFacts({
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(4),
        followUpOutcomes: [
          outcome("", hkDaysAgoIso(1)),
          outcome("NO_REPLY", hkDaysAgoIso(1)),
          outcome("未回复", hkDaysAgoIso(1)),
        ],
      }),
    );
    assert.deepEqual(state.churnRisk.families, []);
  });

  it("reports an unparseable First Contact anchor exactly once and stays normal", () => {
    const state = evaluate(
      stateFacts({ salesStage: "new_lead", createdAt: "not-a-date" }),
    );
    assert.equal(state.firstContact.state, "normal");
    assert.equal(state.firstContact.ageHours, null);
    assert.equal(state.firstContact.anchorAt, null);
    assert.equal(
      state.reasons.filter(
        (entry) => entry.code === "FIRST_CONTACT_ANCHOR_UNPARSEABLE",
      ).length,
      1,
    );
  });

  it("treats a malformed reclamation cycle anchor as the anchor, not createdAt", () => {
    const state = evaluate(
      stateFacts({
        salesStage: "new_lead",
        createdAt: hoursAgoIso(200),
        reclamationCycleStartedAt: "not-a-date",
      }),
    );
    assert.equal(state.firstContact.state, "normal");
    assert.ok(
      state.reasons.some(
        (entry) => entry.code === "FIRST_CONTACT_ANCHOR_UNPARSEABLE",
      ),
    );
    assert.equal(
      state.reasons.some((entry) => entry.code === "FIRST_CONTACT_CRITICAL"),
      false,
      "must not inherit the createdAt clock",
    );
  });
});

describe("R2 §C — a malformed valid-interaction timestamp behaves exactly as absent", () => {
  const stages = ["new_lead", "contacted", "interested", "proposal", "negotiation"];

  for (const stage of stages) {
    it(`${stage}: malformed matches null on every dimension`, () => {
      const absent = evaluate(
        stateFacts({
          salesStage: stage,
          createdAt: hoursAgoIso(100),
          lastValidFollowUpAt: null,
          // Isolate the frozen reclamation parser, which intentionally does not
          // use parseStateInstant and is outside the R2 §C correction.
          reclamationCycleStartedAt: hkDaysAgoIso(0),
        }),
      );
      for (const value of MALFORMED_TIMESTAMPS) {
        const malformed = evaluate(
          stateFacts({
            salesStage: stage,
            createdAt: hoursAgoIso(100),
            lastValidFollowUpAt: value,
            reclamationCycleStartedAt: hkDaysAgoIso(0),
          }),
        );
        assert.deepEqual(malformed.firstContact, absent.firstContact, value);
        assert.deepEqual(malformed.followUpSla, absent.followUpSla, value);
        assert.deepEqual(
          malformed.engagementHealth,
          absent.engagementHealth,
          value,
        );
        assert.deepEqual(malformed.churnRisk, absent.churnRisk, value);
        assert.deepEqual(malformed.attentionLevel, absent.attentionLevel, value);
        assert.deepEqual(
          malformed.reasons.map((entry) => entry.code).sort(),
          absent.reasons.map((entry) => entry.code).sort(),
          value,
        );
      }
    });
  }

  it("adds no reason code of its own beyond the existing not-started codes", () => {
    const state = evaluate(
      stateFacts({ salesStage: "contacted", lastValidFollowUpAt: "not-a-date" }),
    );
    const codes = state.reasons.map((entry) => entry.code);
    assert.ok(codes.includes("SLA_NOT_STARTED"));
    assert.ok(codes.includes("ENGAGEMENT_NOT_STARTED"));
    assert.ok(codes.includes("CHURN_NOT_APPLICABLE_NO_PRIOR_ENGAGEMENT"));
    assert.equal(
      codes.some((code) => code.includes("UNPARSEABLE")),
      false,
      "no unparseable code outside the First Contact anchor",
    );
  });

  it("keeps the final R2 never-contacted behavior for impossible calendar dates", () => {
    for (const value of INVALID_CALENDAR_TIMESTAMPS) {
      const state = evaluate(
        stateFacts({
          salesStage: "contacted",
          createdAt: hoursAgoIso(100),
          lastValidFollowUpAt: value,
          followUpOutcomes: [
            outcome("no_reply", hoursAgoIso(1)),
            outcome("no_reply", hoursAgoIso(2)),
            outcome("lost_contact", hoursAgoIso(3)),
          ],
        }),
      );

      assert.equal(state.firstContact.state, "critical", value);
      assert.equal(state.followUpSla.state, "not_started", value);
      assert.equal(state.engagementHealth.state, "not_started", value);
      assert.equal(state.churnRisk.level, "low", value);
      assert.deepEqual(state.churnRisk.families, [], value);
      assertWellFormed(state, value);
    }
  });

  it("leaves the reclamation dimension on its own frozen helper", () => {
    // RULE N-5 — Reclamation delegates to the frozen anchor chain
    // (cycle start → lastValidFollowUpAt → createdAt) and to
    // `getDaysWithoutValidFollowUp`, which returns 0 for an unparseable anchor.
    // R2 §C unifies the OTHER dimensions only; it must not reinterpret this one.
    const malformed = evaluate(
      stateFacts({
        salesStage: "contacted",
        createdAt: hkDaysAgoIso(50),
        lastValidFollowUpAt: "not-a-date",
      }),
    );
    assert.equal(malformed.reclamationRisk.idleDays, 0);
    assert.equal(malformed.reclamationRisk.state, "none");

    const absent = evaluate(
      stateFacts({
        salesStage: "contacted",
        createdAt: hkDaysAgoIso(50),
        lastValidFollowUpAt: null,
      }),
    );
    assert.equal(absent.reclamationRisk.idleDays, 50);
    assert.equal(absent.reclamationRisk.state, "warning");
  });
});

describe("R1-F — unknown sales stage fail-safe (RULE S-4, N-6, P-5)", () => {
  const unknownStages = [
    "qualified",
    "invalid",
    "negotiation_reminder",
    "pending_second_conversion",
    "",
    "   ",
    "NEW_LEAD",
    "新客户",
  ];

  for (const stage of unknownStages) {
    it(`${JSON.stringify(stage)} exempts the stage-driven dimensions`, () => {
      const state = evaluate(
        stateFacts({
          salesStage: stage,
          createdAt: hkDaysAgoIso(30),
          lastValidFollowUpAt: hkDaysAgoIso(30),
        }),
      );
      assert.equal(normalizeSalesStage(stage).kind, "unknown");
      assert.equal(state.firstContact.state, "exempt");
      assert.equal(state.firstContact.cause, "stage_unknown");
      assert.equal(state.followUpSla.state, "exempt");
      assert.equal(state.followUpSla.cause, "stage_unknown");
      assert.equal(state.engagementHealth.state, "exempt");
      assert.equal(state.engagementHealth.cause, "stage_unknown");
      assert.equal(state.churnRisk.level, "low");
      assert.deepEqual(state.churnRisk.families, []);
      assert.equal(state.profileCompleteness.verdict, "minor_gaps");
      assert.equal(
        state.reasons.filter((entry) => entry.code === "STATE_STAGE_UNKNOWN")
          .length,
        1,
      );
      assert.ok(
        state.reasons.some(
          (entry) => entry.code === "CHURN_NOT_APPLICABLE_STAGE_UNKNOWN",
        ),
      );
    });
  }

  it("never suppresses a genuine reclamation warning, final, or due", () => {
    const expectations = [
      { idle: 41, state: "approaching" },
      { idle: 50, state: "warning" },
      { idle: 54, state: "final" },
      { idle: 55, state: "due" },
      { idle: 90, state: "due" },
    ];
    for (const expectation of expectations) {
      const state = evaluate(
        stateFacts({
          salesStage: "qualified",
          createdAt: hkDaysAgoIso(expectation.idle),
        }),
      );
      assert.equal(state.reclamationRisk.state, expectation.state);
      assert.equal(state.reclamationRisk.idleDays, expectation.idle);
    }
  });

  it("derives Attention from the surviving dimensions (RULE P-5)", () => {
    const urgent = evaluate(
      stateFacts({ salesStage: "qualified", createdAt: hkDaysAgoIso(60) }),
    );
    assert.equal(urgent.reclamationRisk.state, "due");
    assert.equal(urgent.attentionLevel.level, "urgent");

    const low = evaluate(
      stateFacts({ salesStage: "qualified", createdAt: hkDaysAgoIso(1) }),
    );
    assert.equal(low.reclamationRisk.state, "none");
    assert.equal(low.attentionLevel.level, "low");
  });

  it("does not silently map an unknown stage onto a cadence row", () => {
    for (const stage of unknownStages) {
      assert.equal(
        Object.keys(DEFAULT_STAGE_SLA_RULES).includes(stage),
        false,
        stage,
      );
    }
  });
});

describe("R1-I — DEFERRAL_ENDED does not exist (RULE O-6, Q-5)", () => {
  it("is absent from the closed registry", () => {
    for (const forbidden of ["DEFERRAL_ENDED", "SLA_STAGE_UNKNOWN"]) {
      assert.equal(isCustomerStateReasonCode(forbidden), false, forbidden);
      assert.equal(
        (CUSTOMER_STATE_REASON_CODES as readonly string[]).includes(forbidden),
        false,
        forbidden,
      );
    }
  });

  it("is absent from the engine code, appearing only in prose", () => {
    for (const file of readdirSync(STATE_DIR)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      assert.equal(
        stripComments(readFileSync(`${STATE_DIR}/${file}`, "utf8")).includes(
          "DEFERRAL_ENDED",
        ),
        false,
        `${file} must not reference DEFERRAL_ENDED`,
      );
    }
  });

  it("emits no transition-dependent code when leaving On Hold is unobservable", () => {
    // The engine has no previous-state parameter, so an ex-On Hold customer is
    // indistinguishable from one that was never On Hold. Both must look ordinary.
    const state = evaluate(
      stateFacts({ salesStage: "contacted", lastValidFollowUpAt: hkDaysAgoIso(1) }),
    );
    assert.equal(state.followUpSla.state, "on_track");
    assert.equal(
      state.reasons.some((entry) => entry.dimension === "deferral"),
      false,
    );
  });
});

describe("R2 §B — reason-code baseline-state matrix", () => {
  const baselineFacts = stateFacts({
    salesStage: "contacted",
    lastValidFollowUpAt: hkDaysAgoIso(1),
    profile: completeProfile(),
  });

  it("emits zero reasons for an entirely baseline customer", () => {
    const state = evaluate(baselineFacts);
    assert.equal(state.profileCompleteness.verdict, "complete");
    assert.equal(state.firstContact.state, "not_applicable");
    assert.equal(state.followUpSla.state, "on_track");
    assert.equal(state.engagementHealth.state, "active");
    assert.equal(state.churnRisk.level, "low");
    assert.equal(state.reclamationRisk.state, "none");
    assert.equal(state.attentionLevel.level, "low");
    // First Contact `not_applicable` is the one non-baseline state here: it is
    // an applicability statement, so R2 §B still requires its code.
    assert.deepEqual(
      state.reasons.map((entry) => entry.code),
      ["FIRST_CONTACT_NOT_APPLICABLE"],
    );
  });

  it("emits no reason for First Contact normal", () => {
    const state = evaluate(stateFacts({ profile: completeProfile() }));
    assert.equal(state.firstContact.state, "normal");
    assert.equal(
      state.reasons.some((entry) => entry.dimension === "first_contact"),
      false,
    );
  });

  it("requires a code for every problem or non-applicable state", () => {
    const required: {
      label: string;
      facts: CustomerStateFacts;
      code: CustomerStateReasonCode;
    }[] = [
      {
        label: "first contact due_soon",
        facts: stateFacts({ createdAt: hoursAgoIso(30) }),
        code: "FIRST_CONTACT_DUE_SOON",
      },
      {
        label: "first contact overdue",
        facts: stateFacts({ createdAt: hoursAgoIso(60) }),
        code: "FIRST_CONTACT_OVERDUE",
      },
      {
        label: "first contact critical",
        facts: stateFacts({ createdAt: hoursAgoIso(100) }),
        code: "FIRST_CONTACT_CRITICAL",
      },
      {
        label: "first contact exempt",
        facts: stateFacts({ salesStage: "closed_won" }),
        code: "FIRST_CONTACT_EXEMPT",
      },
      {
        label: "sla not_started",
        facts: stateFacts({ salesStage: "contacted" }),
        code: "SLA_NOT_STARTED",
      },
      {
        label: "sla due_soon",
        facts: stateFacts({
          salesStage: "contacted",
          lastValidFollowUpAt: hkDaysAgoIso(6),
        }),
        code: "SLA_STAGE_TARGET_EXCEEDED",
      },
      {
        label: "sla overdue",
        facts: stateFacts({
          salesStage: "contacted",
          lastValidFollowUpAt: hkDaysAgoIso(12),
        }),
        code: "SLA_OVERDUE",
      },
      {
        label: "sla severe_overdue",
        facts: stateFacts({
          salesStage: "contacted",
          lastValidFollowUpAt: hkDaysAgoIso(25),
        }),
        code: "SLA_OVERDUE_SEVERE",
      },
      {
        label: "engagement stable",
        facts: stateFacts({
          salesStage: "contacted",
          lastValidFollowUpAt: hkDaysAgoIso(6),
        }),
        code: "ENGAGEMENT_STABLE",
      },
      {
        label: "engagement cooling",
        facts: stateFacts({
          salesStage: "contacted",
          lastValidFollowUpAt: hkDaysAgoIso(12),
        }),
        code: "ENGAGEMENT_COOLING",
      },
      {
        label: "engagement silent",
        facts: stateFacts({
          salesStage: "contacted",
          lastValidFollowUpAt: hkDaysAgoIso(25),
        }),
        code: "ENGAGEMENT_SILENT",
      },
      {
        label: "churn deferred",
        facts: stateFacts({
          salesStage: "on_hold",
          lastValidFollowUpAt: hkDaysAgoIso(30),
        }),
        code: "CHURN_DEFERRED",
      },
      {
        label: "churn post-sale",
        facts: stateFacts({ salesStage: "paid" }),
        code: "CHURN_NOT_APPLICABLE_POST_SALE",
      },
      {
        label: "churn closed_lost",
        facts: stateFacts({ salesStage: "closed_lost" }),
        code: "CHURN_NOT_APPLICABLE_CLOSED_LOST",
      },
      {
        label: "churn unowned",
        facts: stateFacts({ ownerId: null }),
        code: "CHURN_NOT_APPLICABLE_UNOWNED",
      },
      {
        label: "reclamation exempt",
        facts: stateFacts({ isPinned: 1 }),
        code: "RECLAMATION_EXEMPT",
      },
      {
        label: "reclamation warning",
        facts: stateFacts({ createdAt: hkDaysAgoIso(50) }),
        code: "RECLAMATION_WARNING",
      },
      {
        label: "profile critical gap",
        facts: stateFacts({ profile: emptyProfile() }),
        code: "PROFILE_REQUIRED_IDENTITY_MISSING",
      },
      {
        label: "profile optional gaps",
        facts: stateFacts({ profile: coreProfile() }),
        code: "PROFILE_OPTIONAL_GAPS",
      },
      {
        label: "deferral on hold",
        facts: stateFacts({ salesStage: "on_hold" }),
        code: "DEFERRAL_ON_HOLD",
      },
    ];

    for (const entry of required) {
      const state = evaluate(entry.facts);
      assert.ok(
        state.reasons.some((item) => item.code === entry.code),
        `${entry.label} must emit ${entry.code}`,
      );
    }
  });

  it("invents no HEALTHY / NORMAL / OK reason identifiers", () => {
    for (const code of CUSTOMER_STATE_REASON_CODES) {
      assert.equal(/_(HEALTHY|OK)$/.test(code), false, code);
      assert.equal(code.endsWith("_NORMAL"), false, code);
    }
  });

  it("keeps exclusive codes mutually exclusive per dimension (RULE Q-3)", () => {
    const sweep = buildSweepFacts();
    for (const facts of sweep) {
      const state = evaluate(facts);
      const perDimension = new Map<string, string[]>();
      for (const entry of state.reasons) {
        if (!EXCLUSIVE_REASON_CODES.has(entry.code)) continue;
        const list = perDimension.get(entry.dimension) ?? [];
        list.push(entry.code);
        perDimension.set(entry.dimension, list);
      }
      for (const [dimension, codes] of perDimension) {
        assert.equal(
          codes.length,
          1,
          `${dimension} emitted ${codes.join(", ")} for ${JSON.stringify(facts.salesStage)}`,
        );
      }
    }
  });

  it("never repeats the same code twice in one evaluation", () => {
    for (const facts of buildSweepFacts()) {
      const state = evaluate(facts);
      const codes = state.reasons.map((entry) => entry.code);
      assert.equal(new Set(codes).size, codes.length, codes.join(", "));
    }
  });

  it("keeps ACTION_ELIGIBLE_REASON_CODES a subset of the registry (RULE Q-4)", () => {
    for (const code of ACTION_ELIGIBLE_REASON_CODES) {
      assert.ok(isCustomerStateReasonCode(code), code);
    }
    for (const code of EXCLUSIVE_REASON_CODES) {
      assert.ok(isCustomerStateReasonCode(code), code);
    }
    assert.equal(
      new Set(CUSTOMER_STATE_REASON_CODES).size,
      CUSTOMER_STATE_REASON_CODES.length,
    );
  });
});

describe("Post-sale and closed_lost exclusion (RULE S-3, K-2)", () => {
  for (const stage of ["closed_won", "paid", "closed_lost"] as const) {
    it(`${stage} exempts First Contact, SLA, and Engagement even with a stale history`, () => {
      const state = evaluate(
        stateFacts({
          salesStage: stage,
          createdAt: hkDaysAgoIso(300),
          lastValidFollowUpAt: hkDaysAgoIso(300),
          nextFollowUpAt: hkDaysAgoIso(200),
          // Fresh cycle anchor so the reclamation clock (which `closed_lost`
          // does not exempt) cannot mask the stage exclusion under test.
          reclamationCycleStartedAt: hkDaysAgoIso(0),
          followUpOutcomes: [
            ...repeatOutcome("no_reply", 5, 1),
            outcome("lost_contact", hkDaysAgoIso(1)),
          ],
        }),
      );
      const cause = stage === "closed_lost" ? "closed_lost" : "post_sale";
      assert.equal(state.firstContact.state, "exempt");
      assert.equal(state.firstContact.cause, cause);
      assert.equal(state.followUpSla.state, "exempt");
      assert.equal(state.followUpSla.cause, cause);
      assert.equal(state.followUpSla.stageDueAt, null);
      assert.equal(state.followUpSla.effectiveDueAt, null);
      assert.equal(state.engagementHealth.state, "exempt");
      assert.equal(state.churnRisk.level, "low");
      assert.deepEqual(state.churnRisk.families, []);
      assert.equal(state.attentionLevel.level, "low");
    });
  }

  it("still evaluates completeness and reclamation for post-sale customers", () => {
    const state = evaluate(
      stateFacts({
        salesStage: "closed_won",
        profile: emptyProfile(),
        createdAt: hkDaysAgoIso(300),
      }),
    );
    assert.equal(state.profileCompleteness.verdict, "critical_gaps");
    // `closed_won` is an excluded reclamation stage in the frozen rules.
    assert.equal(state.reclamationRisk.state, "exempt");
    assert.equal(state.reclamationRisk.cause, "excluded_stage");
  });

  it("keeps reporting reclamation for closed_lost, which the frozen rules do not exempt", () => {
    const state = evaluate(
      stateFacts({ salesStage: "closed_lost", createdAt: hkDaysAgoIso(300) }),
    );
    assert.equal(state.followUpSla.state, "exempt");
    assert.equal(state.reclamationRisk.state, "due");
    assert.equal(state.attentionLevel.level, "urgent");
    assert.ok(
      state.reasons.some(
        (entry) => entry.code === "ATTENTION_URGENT_RECLAMATION",
      ),
    );
  });
});

describe("Unowned / Public Pool (RULE S-6)", () => {
  const variants = [
    { label: "ownerId null", facts: { ownerId: null } },
    { label: "status public_pool", facts: { status: "public_pool" } },
    {
      label: "both",
      facts: { ownerId: null, status: "public_pool" },
    },
  ];

  for (const variant of variants) {
    it(`${variant.label} removes staff SLA accountability`, () => {
      const state = evaluate(
        stateFacts({
          salesStage: "negotiation",
          createdAt: hkDaysAgoIso(90),
          lastValidFollowUpAt: hkDaysAgoIso(90),
          followUpOutcomes: repeatOutcome("no_reply", 3, 1),
          ...variant.facts,
        }),
      );
      assert.equal(state.firstContact.state, "exempt");
      assert.equal(state.firstContact.cause, "unowned");
      assert.equal(state.followUpSla.state, "exempt");
      assert.equal(state.engagementHealth.state, "exempt");
      assert.equal(state.churnRisk.level, "low");
      assert.ok(
        state.reasons.some(
          (entry) => entry.code === "CHURN_NOT_APPLICABLE_UNOWNED",
        ),
      );
      assert.equal(state.reclamationRisk.state, "exempt");
      assert.equal(state.reclamationRisk.cause, "unowned");
      assert.equal(state.attentionLevel.level, "low");
    });
  }

  it("evaluates Public Pool profile completeness normally", () => {
    const state = evaluate(
      stateFacts({
        status: "public_pool",
        ownerId: null,
        profile: emptyProfile(),
      }),
    );
    assert.equal(state.profileCompleteness.verdict, "critical_gaps");
  });
});

describe("On Hold deferral (RULE O-1..O-5)", () => {
  const onHold = (overrides: Partial<CustomerStateFacts> = {}) =>
    evaluate(
      stateFacts({
        salesStage: "on_hold",
        createdAt: hkDaysAgoIso(120),
        lastValidFollowUpAt: hkDaysAgoIso(120),
        isPinned: 1,
        ...overrides,
      }),
    );

  it("defers the three staff-cadence dimensions with one deferral reason", () => {
    const state = onHold();
    assert.equal(state.firstContact.state, "deferred");
    assert.equal(state.followUpSla.state, "deferred");
    assert.equal(state.engagementHealth.state, "deferred");
    assert.equal(
      state.reasons.filter((entry) => entry.code === "DEFERRAL_ON_HOLD").length,
      1,
    );
    assert.equal(state.followUpSla.stageDueAt, null);
    assert.equal(state.followUpSla.effectiveDueAt, null);
  });

  it("keeps Churn low with CHURN_DEFERRED unless a decisive signal applies", () => {
    const quiet = onHold({ followUpOutcomes: repeatOutcome("no_reply", 4, 1) });
    assert.equal(quiet.churnRisk.level, "low");
    assert.ok(quiet.reasons.some((entry) => entry.code === "CHURN_DEFERRED"));
    assert.equal(quiet.attentionLevel.level, "low");

    const decisive = onHold({
      followUpOutcomes: [outcome("not_interested", hkDaysAgoIso(1))],
    });
    assert.equal(decisive.churnRisk.level, "high");
    assert.deepEqual(decisive.churnRisk.families, [
      "EXPLICIT_NEGATIVE_CUSTOMER_SIGNAL",
    ]);
    assert.equal(decisive.attentionLevel.level, "urgent");
  });

  it("does not treat a future nextFollowUpAt as a deferral (RULE O-2)", () => {
    const state = evaluate(
      stateFacts({
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(25),
        nextFollowUpAt: hkDaysAgoIso(-30),
      }),
    );
    assert.equal(state.followUpSla.state, "severe_overdue");
    assert.equal(state.firstContact.state, "not_applicable");
    assert.equal(
      state.reasons.some((entry) => entry.dimension === "deferral"),
      false,
    );
  });

  it("evaluates On Hold profile completeness normally", () => {
    const state = onHold({ profile: emptyProfile() });
    assert.equal(state.profileCompleteness.verdict, "critical_gaps");
  });
});

describe("Attention Level precedence (RULE P-1..P-6)", () => {
  it("never lets stage alone manufacture urgency (RULE P-3)", () => {
    for (const stage of CANONICAL_STAGES) {
      const state = evaluate(
        stateFacts({
          salesStage: stage,
          lastValidFollowUpAt: hkDaysAgoIso(1),
          profile: completeProfile(),
        }),
      );
      assert.equal(state.attentionLevel.level, "low", stage);
    }
  });

  it("promotes churn medium to high only in a high-intent stage", () => {
    for (const stage of [
      "contacted",
      "interested",
      "proposal",
      "negotiation",
    ] as const) {
      // Family B alone, with the cadence still on track, so the level is
      // decided purely by churn severity and stage class.
      const state = evaluate(
        stateFacts({
          salesStage: stage,
          lastValidFollowUpAt: hkDaysAgoIso(1),
          followUpOutcomes: [
            outcome("no_reply", hoursAgoIso(1)),
            outcome("no_reply", hoursAgoIso(2)),
          ],
        }),
      );
      assert.equal(state.followUpSla.state, "on_track", stage);
      assert.equal(state.churnRisk.level, "medium", stage);
      assert.equal(
        state.attentionLevel.level,
        stage === "contacted" ? "normal" : "high",
        stage,
      );
      assert.ok(
        state.reasons.some((entry) =>
          stage === "contacted"
            ? entry.code === "ATTENTION_NORMAL_CHURN"
            : entry.code === "ATTENTION_HIGH_CHURN_HIGH_INTENT",
        ),
        stage,
      );
    }
  });

  it("escalates SLA_WARNING_REACHED to high", () => {
    const state = evaluate(
      stateFacts({
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(7),
        reclamationCycleStartedAt: hkDaysAgoIso(0),
      }),
    );
    assert.equal(state.followUpSla.state, "due_soon");
    assert.ok(state.reasons.some((entry) => entry.code === "SLA_WARNING_REACHED"));
    assert.equal(state.attentionLevel.level, "high");
    assert.ok(
      state.reasons.some((entry) => entry.code === "ATTENTION_HIGH_SLA_WARNING"),
    );
  });

  it("is a terminal output that no dimension consumes (RULE P-6)", () => {
    const consumers = readdirSync(STATE_DIR).filter((file) => {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) return false;
      if (file === "attention-level.ts" || file === "engine.ts") return false;
      if (file === "index.ts") return false;
      return readFileSync(`${STATE_DIR}/${file}`, "utf8").includes(
        "attention-level",
      );
    });
    assert.deepEqual(consumers, []);
  });
});

describe("Purity, determinism, and the single injected now (RULE F-1, R-0)", () => {
  it("returns deep-equal output for repeated calls", () => {
    for (const facts of buildSweepFacts()) {
      const first = evaluate(facts);
      const second = evaluate(facts);
      assert.deepEqual(first, second);
    }
  });

  it("does not mutate the supplied facts", () => {
    const facts = stateFacts({
      salesStage: "contacted",
      lastValidFollowUpAt: hkDaysAgoIso(12),
      followUpOutcomes: repeatOutcome("no_reply", 3, 1),
    });
    const snapshot = structuredClone(facts);
    evaluate(deepFreeze(facts));
    assert.deepEqual(facts, snapshot);
  });

  it("does not mutate the supplied rules or now", () => {
    const rules = structuredClone(DEFAULT_CUSTOMER_STATE_RULES);
    const now = new Date(NOW.getTime());
    computeCustomerState(
      stateFacts({ salesStage: "contacted", lastValidFollowUpAt: hkDaysAgoIso(12) }),
      deepFreeze(rules),
      now,
    );
    assert.deepEqual(rules, DEFAULT_CUSTOMER_STATE_RULES);
    assert.equal(now.getTime(), NOW.getTime());
  });

  it("reports evaluatedAt as exactly the injected now (RULE F-3)", () => {
    for (const now of [NOW, new Date("2020-01-01T00:00:00.000Z"), new Date(0)]) {
      const state = computeCustomerState(
        stateFacts(),
        DEFAULT_CUSTOMER_STATE_RULES,
        now,
      );
      assert.equal(state.evaluatedAt, now.toISOString());
    }
  });

  it("reads no wall clock inside the engine source", () => {
    for (const file of readdirSync(STATE_DIR)) {
      if (!file.endsWith(".ts")) continue;
      if (file.endsWith(".test.ts") || file.includes("test-helper")) continue;
      const withoutComments = stripComments(
        readFileSync(`${STATE_DIR}/${file}`, "utf8"),
      );
      assert.equal(
        /new Date\(\s*\)/.test(withoutComments),
        false,
        `${file} calls new Date()`,
      );
      assert.equal(
        withoutComments.includes("Date.now("),
        false,
        `${file} calls Date.now()`,
      );
      for (const forbidden of ["fetch(", "console.", "process.env", "@/lib/db"]) {
        assert.equal(
          withoutComments.includes(forbidden),
          false,
          `${file} references ${forbidden}`,
        );
      }
    }
  });

  it("shifts every time-dependent state when only now moves", () => {
    const facts = stateFacts({
      salesStage: "contacted",
      createdAt: hkDaysAgoIso(1),
      lastValidFollowUpAt: hkDaysAgoIso(1),
    });
    const early = evaluate(facts);
    const later = evaluate(facts, new Date(NOW.getTime() + 60 * 86_400_000));
    assert.equal(early.followUpSla.state, "on_track");
    assert.equal(later.followUpSla.state, "severe_overdue");
    assert.equal(early.engagementHealth.state, "active");
    assert.equal(later.engagementHealth.state, "silent");
    assert.equal(early.reclamationRisk.state, "none");
    assert.equal(later.reclamationRisk.state, "due");
  });

  it("carries the rule version through to the output (RULE W-1)", () => {
    const state = evaluate(stateFacts());
    assert.equal(state.ruleVersion, CUSTOMER_STATE_RULE_VERSION);
    assert.equal(state.ruleVersion, "customer_state_v2");

    const custom = computeCustomerState(
      stateFacts(),
      { ...DEFAULT_CUSTOMER_STATE_RULES, ruleVersion: "customer_state_v2.1" },
      NOW,
    );
    assert.equal(custom.ruleVersion, "customer_state_v2.1");
  });
});

describe("RULE V-3 — rule resolution is fail-safe and all-or-nothing per section", () => {
  it("uses code defaults for absent input", () => {
    for (const input of [undefined, null]) {
      const resolved = resolveCustomerStateRules(input);
      assert.deepEqual(resolved.rules, DEFAULT_CUSTOMER_STATE_RULES);
      assert.deepEqual(resolved.warnings, []);
    }
  });

  it("never throws on hostile input", () => {
    const hostile: unknown[] = [
      0,
      "",
      "customer_state_rules",
      true,
      [],
      [1, 2, 3],
      { stageSla: null },
      { stageSla: [] },
      { firstContact: { dueSoonHours: "24" } },
      { firstContact: { dueSoonHours: 72, overdueHours: 48, criticalHours: 24 } },
      { churn: { repeatedNonResponseWindowDays: -1 } },
      { completeness: { weights: {} } },
      { ruleVersion: "   " },
      { stageSla: { new_lead: { targetDays: 0 } } },
      { unknownSection: { nested: true } },
    ];
    for (const input of hostile) {
      const resolved = resolveCustomerStateRules(input);
      assert.equal(typeof resolved.rules.ruleVersion, "string");
      assert.ok(resolved.rules.ruleVersion.trim().length > 0);
      assert.equal(Object.keys(resolved.rules.stageSla).length, 5);
    }
  });

  it("replaces an invalid section wholesale instead of partially", () => {
    const resolved = resolveCustomerStateRules({
      stageSla: {
        new_lead: { targetDays: 1, warningDays: 2, overdueDays: 3, severeDays: 4 },
        contacted: { targetDays: 5 },
      },
    });
    assert.deepEqual(resolved.rules.stageSla, DEFAULT_STAGE_SLA_RULES);
    assert.deepEqual(
      resolved.warnings.map((entry) => entry.section),
      ["stageSla"],
    );
  });

  it("accepts a fully valid override section", () => {
    const stageSla = {
      new_lead: { targetDays: 1, warningDays: 2, overdueDays: 3, severeDays: 4 },
      contacted: { targetDays: 2, warningDays: 3, overdueDays: 4, severeDays: 5 },
      interested: { targetDays: 3, warningDays: 4, overdueDays: 5, severeDays: 6 },
      proposal: { targetDays: 4, warningDays: 5, overdueDays: 6, severeDays: 7 },
      negotiation: { targetDays: 5, warningDays: 6, overdueDays: 7, severeDays: 8 },
    };
    const resolved = resolveCustomerStateRules({ stageSla });
    assert.deepEqual(resolved.rules.stageSla, stageSla);
    assert.deepEqual(resolved.warnings, []);
    assert.deepEqual(resolved.rules.churn, DEFAULT_CUSTOMER_STATE_RULES.churn);
  });

  it("rejects a completeness section whose weights do not total 100", () => {
    const resolved = resolveCustomerStateRules({
      completeness: {
        requiredGroups: ["REQ_IDENTITY", "REQ_REACHABLE"],
        coreGroups: ["CORE_PRIMARY_CHANNEL", "CORE_NEED_CAPTURED", "CORE_CONTEXT"],
        optionalGroups: [
          "OPT_SECOND_CHANNEL",
          "OPT_EMAIL",
          "OPT_PREFERRED_CONTACT",
          "OPT_DEMOGRAPHICS",
          "OPT_PROFESSIONAL",
        ],
        weights: {
          REQ_IDENTITY: 30,
          REQ_REACHABLE: 25,
          CORE_PRIMARY_CHANNEL: 12,
          CORE_NEED_CAPTURED: 12,
          CORE_CONTEXT: 11,
          OPT_SECOND_CHANNEL: 3,
          OPT_EMAIL: 3,
          OPT_PREFERRED_CONTACT: 3,
          OPT_DEMOGRAPHICS: 3,
          OPT_PROFESSIONAL: 3,
        },
      },
    });
    assert.deepEqual(
      resolved.rules.completeness,
      DEFAULT_CUSTOMER_STATE_RULES.completeness,
    );
    assert.deepEqual(
      resolved.warnings.map((entry) => entry.section),
      ["completeness"],
    );
  });

  it("keeps automatic_reclaim_days out of the contract (RULE V-4)", () => {
    assert.equal(
      Object.keys(DEFAULT_CUSTOMER_STATE_RULES).includes(
        "automaticReclaimDays",
      ),
      false,
    );
    const resolved = resolveCustomerStateRules({ automaticReclaimDays: 9 });
    assert.equal(
      Object.keys(resolved.rules).includes("automaticReclaimDays"),
      false,
    );
  });

  it("carries no rollout timestamp (RULE V-7)", () => {
    const serialized = JSON.stringify(DEFAULT_CUSTOMER_STATE_RULES);
    for (const forbidden of ["Cutoff", "cutoff", "rolloutAt", "backlog"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });
});

/**
 * Fact sweep used by the invariant tests: every canonical stage crossed with a
 * spread of interaction histories, ownership shapes, and profile fixtures.
 */
function buildSweepFacts(): CustomerStateFacts[] {
  const histories: Partial<CustomerStateFacts>[] = [
    {},
    { createdAt: hoursAgoIso(100) },
    { lastValidFollowUpAt: hkDaysAgoIso(1) },
    { lastValidFollowUpAt: hkDaysAgoIso(6) },
    { lastValidFollowUpAt: hkDaysAgoIso(12), nextFollowUpAt: hkDaysAgoIso(2) },
    {
      lastValidFollowUpAt: hkDaysAgoIso(30),
      followUpOutcomes: repeatOutcome("no_reply", 3, 1),
    },
    {
      lastValidFollowUpAt: hkDaysAgoIso(4),
      followUpOutcomes: [outcome("lost_contact", hkDaysAgoIso(1))],
    },
    { lastValidFollowUpAt: "not-a-date", createdAt: "also-not-a-date" },
    { createdAt: hkDaysAgoIso(60) },
    { isPinned: 1, createdAt: hkDaysAgoIso(60) },
    { hasCollaborator: true, createdAt: hkDaysAgoIso(60) },
    { ownerId: null },
    { status: "public_pool" },
    { reclaimRuleGraceUntil: hkDaysAgoIso(-3), createdAt: hkDaysAgoIso(60) },
  ];
  const profiles = [emptyProfile(), coreProfile(), completeProfile()];
  const stages = [...CANONICAL_STAGES, "qualified", "negotiating", ""];

  const facts: CustomerStateFacts[] = [];
  for (const stage of stages) {
    for (const history of histories) {
      for (const profile of profiles) {
        facts.push(stateFacts({ salesStage: stage, profile, ...history }));
      }
    }
  }
  return facts;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
