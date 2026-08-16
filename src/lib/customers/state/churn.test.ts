/**
 * TASK 17-C1 — Churn Risk coverage.
 *
 * Y-4  valid-outcome contract
 * Y-5  never-contacted Churn isolation (RULE K-4)
 * Y-6  churn family independence (RULE L-2a, L-5)
 * R1-A `no_reply` counts
 * R1-B `no_contact` counts
 * R1-C mixed counts
 * R1-D supersession
 * R1-E `contacted` churn matrix (and `new_lead` negative control)
 * R1-K Family B window boundary (R2 §E integer day 60 / day 61)
 * R1-N `nextFollowUpAt` non-leakage
 * plus Reclamation / Churn semantic independence
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FOLLOW_UP_OUTCOMES,
  VALID_FOLLOW_UP_OUTCOMES,
  isValidFollowUpOutcome,
} from "@/lib/constants/follow-up-outcomes";
import { computeCustomerState } from "./engine";
import { DEFAULT_CHURN_RULES, DEFAULT_CUSTOMER_STATE_RULES } from "./rules";
import { ACTIVE_SLA_STAGES, CANONICAL_STAGES } from "./stages";
import type {
  ChurnFamily,
  CustomerStateFacts,
  FollowUpOutcomeFact,
} from "./types";
import {
  NOW,
  hkDaysAgoIso,
  hkInstant,
  hoursAgoIso,
  outcome,
  repeatOutcome,
  stateFacts,
} from "./state-fixtures.test-helper";

function evaluate(facts: CustomerStateFacts, now = NOW) {
  return computeCustomerState(facts, DEFAULT_CUSTOMER_STATE_RULES, now);
}

/** `contacted` with a 12-day-old valid interaction ⇒ Engagement `cooling` ⇒ Family A. */
function coolingContacted(
  followUpOutcomes: CustomerStateFacts["followUpOutcomes"],
): CustomerStateFacts {
  return stateFacts({
    salesStage: "contacted",
    lastValidFollowUpAt: hkDaysAgoIso(12),
    followUpOutcomes,
  });
}

/** `contacted` with a 4-day-old valid interaction ⇒ Engagement `active` ⇒ no Family A. */
function activeContacted(
  followUpOutcomes: CustomerStateFacts["followUpOutcomes"],
): CustomerStateFacts {
  return stateFacts({
    salesStage: "contacted",
    lastValidFollowUpAt: hkDaysAgoIso(4),
    followUpOutcomes,
  });
}

/**
 * `count` non-response records, hourly, all inside the 60-day window and all
 * strictly after `activeContacted`'s valid interaction so none is superseded.
 */
function nonResponse(
  outcomeValue: string,
  count: number,
  firstHoursAgo = 1,
): FollowUpOutcomeFact[] {
  return Array.from({ length: count }, (_, index) =>
    outcome(outcomeValue, hoursAgoIso(firstHoursAgo + index)),
  );
}

function familiesOf(facts: CustomerStateFacts): ChurnFamily[] {
  return evaluate(facts).churnRisk.families;
}

describe("Y-4 — valid-outcome contract (RULE D-1, D-2)", () => {
  it("classifies all 11 outcomes exactly once", () => {
    assert.equal(FOLLOW_UP_OUTCOMES.length, 11);
    assert.equal(new Set(FOLLOW_UP_OUTCOMES).size, 11);
    const invalid = FOLLOW_UP_OUTCOMES.filter(
      (value) => !isValidFollowUpOutcome(value),
    );
    assert.deepEqual([...VALID_FOLLOW_UP_OUTCOMES].sort(), [
      "awaiting_documents",
      "awaiting_internal_confirmation",
      "awaiting_quotation",
      "considering",
      "contact_made",
      "interested",
      "replied",
    ]);
    assert.deepEqual(invalid.sort(), [
      "lost_contact",
      "no_contact",
      "no_reply",
      "not_interested",
    ]);
  });

  it("uses only invalid outcomes as churn evidence", () => {
    const churnOutcomes = [
      ...DEFAULT_CHURN_RULES.noReplyOutcomes,
      ...DEFAULT_CHURN_RULES.noContactOutcomes,
      ...DEFAULT_CHURN_RULES.decisiveOutcomes,
    ];
    for (const value of churnOutcomes) {
      assert.ok(
        !(VALID_FOLLOW_UP_OUTCOMES as readonly string[]).includes(value),
        value,
      );
    }
    assert.deepEqual([...DEFAULT_CHURN_RULES.decisiveOutcomes], [
      "lost_contact",
      "not_interested",
    ]);
  });

  it("distinguishes FOLLOW-UP RECORD EXISTS from VALID INTERACTION (RULE D-2, H-7)", () => {
    // Attempt-only history: records exist, no valid interaction was ever logged.
    const state = evaluate(
      stateFacts({
        salesStage: "contacted",
        createdAt: hkDaysAgoIso(40),
        lastValidFollowUpAt: null,
        followUpOutcomes: repeatOutcome("no_contact", 3, 5),
      }),
    );
    assert.equal(state.firstContact.state, "critical");
    assert.equal(state.followUpSla.state, "not_started");
    assert.equal(state.engagementHealth.state, "not_started");
    assert.equal(state.churnRisk.level, "low");
    assert.deepEqual(state.churnRisk.families, []);
  });

  it("does not let a valid outcome recorded in follow_ups act as churn evidence", () => {
    const state = evaluate(
      coolingContacted([
        ...repeatOutcome("contact_made", 5, 1),
        ...repeatOutcome("interested", 3, 2),
      ]),
    );
    assert.deepEqual(state.churnRisk.families, ["ENGAGEMENT_DETERIORATION"]);
    assert.equal(state.churnRisk.level, "medium");
  });
});

describe("Y-5 — never-contacted Churn isolation is absolute (RULE K-4)", () => {
  const signalCombinations: {
    label: string;
    outcomes: CustomerStateFacts["followUpOutcomes"];
  }[] = [
    { label: "no records", outcomes: [] },
    { label: "3× no_contact", outcomes: repeatOutcome("no_contact", 3, 5) },
    { label: "5× no_reply", outcomes: repeatOutcome("no_reply", 5, 5) },
    {
      label: "mixed non-response",
      outcomes: [
        ...repeatOutcome("no_reply", 2, 5),
        ...repeatOutcome("no_contact", 4, 9),
      ],
    },
    {
      label: "decisive lost_contact",
      outcomes: [outcome("lost_contact", hkDaysAgoIso(2))],
    },
    {
      label: "decisive not_interested",
      outcomes: [outcome("not_interested", hkDaysAgoIso(2))],
    },
    {
      label: "every signal at once",
      outcomes: [
        ...repeatOutcome("no_reply", 3, 5),
        ...repeatOutcome("no_contact", 3, 9),
        outcome("lost_contact", hkDaysAgoIso(1)),
        outcome("not_interested", hkDaysAgoIso(2)),
      ],
    },
  ];

  for (const stage of CANONICAL_STAGES) {
    for (const combination of signalCombinations) {
      it(`${stage} + ${combination.label} + never contacted → low with no families`, () => {
        const state = evaluate(
          stateFacts({
            salesStage: stage,
            createdAt: hkDaysAgoIso(40),
            lastValidFollowUpAt: null,
            followUpOutcomes: combination.outcomes,
          }),
        );
        assert.equal(state.churnRisk.level, "low");
        assert.deepEqual(state.churnRisk.families, []);
      });
    }
  }

  it("also isolates a malformed lastValidFollowUpAt (R2 §C)", () => {
    const state = evaluate(
      stateFacts({
        salesStage: "contacted",
        lastValidFollowUpAt: "2026-13-45T99:99:99Z",
        followUpOutcomes: [
          ...repeatOutcome("no_reply", 3, 5),
          outcome("lost_contact", hkDaysAgoIso(1)),
        ],
      }),
    );
    assert.equal(state.churnRisk.level, "low");
    assert.deepEqual(state.churnRisk.families, []);
    assert.ok(
      state.reasons.some(
        (entry) => entry.code === "CHURN_NOT_APPLICABLE_NO_PRIOR_ENGAGEMENT",
      ),
    );
  });

  it("emits the non-applicability reason so low is never read as healthy", () => {
    const state = evaluate(
      stateFacts({ salesStage: "contacted", createdAt: hkDaysAgoIso(40) }),
    );
    assert.ok(
      state.reasons.some(
        (entry) => entry.code === "CHURN_NOT_APPLICABLE_NO_PRIOR_ENGAGEMENT",
      ),
    );
  });
});

describe("Y-6 — churn family independence (RULE L-2a, L-5, M-0)", () => {
  it("counts Family A once, never twice with ENGAGEMENT_SILENT", () => {
    const state = evaluate(
      stateFacts({
        salesStage: "negotiation",
        lastValidFollowUpAt: hkDaysAgoIso(20),
      }),
    );
    assert.equal(state.engagementHealth.state, "silent");
    assert.deepEqual(state.churnRisk.families, ["ENGAGEMENT_DETERIORATION"]);
    assert.equal(state.churnRisk.level, "medium");
  });

  it("counts Family B once regardless of record volume", () => {
    for (const count of [3, 4, 10, 25]) {
      const families = familiesOf(
        activeContacted(nonResponse("no_contact", count)),
      );
      assert.deepEqual(families, ["REPEATED_NON_RESPONSE"], `count ${count}`);
    }
  });

  it("counts Family C once regardless of decisive record volume", () => {
    const state = evaluate(
      activeContacted([
        outcome("lost_contact", hkDaysAgoIso(0)),
        outcome("lost_contact", hkDaysAgoIso(1)),
        outcome("not_interested", hkDaysAgoIso(2)),
      ]),
    );
    assert.deepEqual(state.churnRisk.families, [
      "EXPLICIT_NEGATIVE_CUSTOMER_SIGNAL",
    ]);
    assert.equal(state.churnRisk.level, "high");
  });

  it("requires A AND B for high without a decisive signal (RULE L-9)", () => {
    assert.equal(
      evaluate(coolingContacted(repeatOutcome("no_reply", 2, 5))).churnRisk
        .level,
      "high",
    );
    assert.equal(
      evaluate(coolingContacted([])).churnRisk.level,
      "medium",
    );
    assert.equal(
      evaluate(activeContacted(nonResponse("no_reply", 2))).churnRisk.level,
      "medium",
    );
  });

  it("specifies no fourth family (RULE L-8)", () => {
    const state = evaluate(
      coolingContacted([
        ...repeatOutcome("no_reply", 3, 5),
        outcome("lost_contact", hkDaysAgoIso(1)),
      ]),
    );
    assert.equal(state.churnRisk.families.length, 3);
    assert.deepEqual([...state.churnRisk.families].sort(), [
      "ENGAGEMENT_DETERIORATION",
      "EXPLICIT_NEGATIVE_CUSTOMER_SIGNAL",
      "REPEATED_NON_RESPONSE",
    ]);
  });
});

describe("R1-A — Family B no_reply counts", () => {
  const cases = [
    { count: 1, fired: false },
    { count: 2, fired: true },
    { count: 3, fired: true },
  ];
  for (const testCase of cases) {
    it(`${testCase.count}× no_reply → ${testCase.fired}`, () => {
      const state = evaluate(
        activeContacted(nonResponse("no_reply", testCase.count)),
      );
      const familyReason = state.reasons.find(
        (entry) => entry.code === "CHURN_REPEATED_NON_RESPONSE",
      );
      assert.equal(familyReason !== undefined, testCase.fired);
      if (testCase.fired) {
        assert.deepEqual(state.churnRisk.families, ["REPEATED_NON_RESPONSE"]);
        assert.equal(familyReason?.params?.triggeredBy, "no_reply");
        assert.equal(familyReason?.params?.noReplyCount, testCase.count);
        assert.equal(familyReason?.params?.windowDays, 60);
      }
    });
  }
});

describe("R1-B — Family B no_contact counts", () => {
  const cases = [
    { count: 1, fired: false },
    { count: 2, fired: false },
    { count: 3, fired: true },
    { count: 4, fired: true },
  ];
  for (const testCase of cases) {
    it(`${testCase.count}× no_contact → ${testCase.fired}`, () => {
      const state = evaluate(
        activeContacted(nonResponse("no_contact", testCase.count)),
      );
      const familyReason = state.reasons.find(
        (entry) => entry.code === "CHURN_REPEATED_NON_RESPONSE",
      );
      assert.equal(familyReason !== undefined, testCase.fired);
      if (testCase.fired) {
        assert.deepEqual(state.churnRisk.families, ["REPEATED_NON_RESPONSE"]);
        assert.equal(familyReason?.params?.triggeredBy, "no_contact");
        assert.equal(familyReason?.params?.noContactCount, testCase.count);
      }
    });
  }
});

describe("R1-C — Family B mixed counts", () => {
  const cases = [
    { noReply: 1, noContact: 1, fired: false, triggeredBy: null },
    { noReply: 1, noContact: 2, fired: true, triggeredBy: "mixed" },
    { noReply: 2, noContact: 0, fired: true, triggeredBy: "no_reply" },
    { noReply: 0, noContact: 2, fired: false, triggeredBy: null },
  ] as const;

  for (const testCase of cases) {
    it(`${testCase.noReply}× no_reply + ${testCase.noContact}× no_contact → ${testCase.fired}`, () => {
      const state = evaluate(
        activeContacted([
          ...nonResponse("no_reply", testCase.noReply),
          ...nonResponse("no_contact", testCase.noContact, 30),
        ]),
      );
      const familyReason = state.reasons.find(
        (entry) => entry.code === "CHURN_REPEATED_NON_RESPONSE",
      );
      assert.equal(familyReason !== undefined, testCase.fired);
      if (testCase.triggeredBy) {
        assert.equal(familyReason?.params?.triggeredBy, testCase.triggeredBy);
      }
    });
  }
});

describe("R1-D — supersession (RULE L-4, L-7)", () => {
  // 4 days keeps Engagement `active`, so only Family B can appear here.
  const lastValid = hkDaysAgoIso(4);

  it("excludes non-response records recorded before the valid interaction", () => {
    const state = evaluate(
      activeContacted(repeatOutcome("no_contact", 3, 5)),
    );
    assert.deepEqual(state.churnRisk.families, []);
  });

  it("excludes non-response records recorded AT the valid interaction instant", () => {
    const state = evaluate(
      activeContacted([
        outcome("no_contact", lastValid),
        outcome("no_contact", lastValid),
        outcome("no_contact", lastValid),
      ]),
    );
    assert.deepEqual(state.churnRisk.families, []);
  });

  it("includes non-response records recorded after the valid interaction", () => {
    const state = evaluate(activeContacted(nonResponse("no_contact", 3)));
    assert.deepEqual(state.churnRisk.families, ["REPEATED_NON_RESPONSE"]);
  });

  it("cancels a previously firing Family B once a later valid interaction lands", () => {
    const records = repeatOutcome("no_contact", 3, 20);
    const before = evaluate(
      stateFacts({
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(30),
        reclamationCycleStartedAt: hkDaysAgoIso(0),
        followUpOutcomes: records,
      }),
    );
    const after = evaluate(
      stateFacts({
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(1),
        followUpOutcomes: records,
      }),
    );
    assert.ok(before.churnRisk.families.includes("REPEATED_NON_RESPONSE"));
    assert.deepEqual(after.churnRisk.families, []);
    assert.equal(after.churnRisk.level, "low");
  });

  it("supersedes a decisive Family C signal with a later valid interaction", () => {
    const decisive = [outcome("not_interested", hkDaysAgoIso(13))];
    const superseded = evaluate(
      stateFacts({
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(3),
        followUpOutcomes: decisive,
      }),
    );
    const current = evaluate(
      stateFacts({
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(20),
        reclamationCycleStartedAt: hkDaysAgoIso(0),
        followUpOutcomes: decisive,
      }),
    );
    assert.equal(superseded.churnRisk.level, "low");
    assert.deepEqual(superseded.churnRisk.families, []);
    assert.equal(current.churnRisk.level, "high");
  });

  it("has no lookback window for Family C (RULE L-7)", () => {
    const state = evaluate(
      stateFacts({
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(400),
        reclamationCycleStartedAt: hkDaysAgoIso(0),
        followUpOutcomes: [outcome("lost_contact", hkDaysAgoIso(300))],
      }),
    );
    assert.equal(state.churnRisk.level, "high");
    assert.ok(state.reasons.some((entry) => entry.code === "CHURN_LOST_CONTACT"));
  });
});

describe("R1-E — contacted churn matrix, with new_lead as negative control", () => {
  const matrix = [
    { label: "never valid", days: null, engagement: "not_started", familyA: false },
    { label: "active", days: 3, engagement: "active", familyA: false },
    { label: "stable", days: 8, engagement: "stable", familyA: false },
    { label: "cooling", days: 15, engagement: "cooling", familyA: true },
    { label: "silent", days: 25, engagement: "silent", familyA: true },
  ] as const;

  for (const row of matrix) {
    it(`contacted + ${row.label} → Family A ${row.familyA}`, () => {
      const state = evaluate(
        stateFacts({
          salesStage: "contacted",
          createdAt: hkDaysAgoIso(40),
          lastValidFollowUpAt: row.days === null ? null : hkDaysAgoIso(row.days),
        }),
      );
      assert.equal(state.engagementHealth.state, row.engagement);
      assert.equal(
        state.churnRisk.families.includes("ENGAGEMENT_DETERIORATION"),
        row.familyA,
      );
      if (row.days === null) {
        assert.equal(state.churnRisk.level, "low");
        assert.ok(
          state.reasons.some(
            (entry) => entry.code === "CHURN_NOT_APPLICABLE_NO_PRIOR_ENGAGEMENT",
          ),
        );
      }
    });
  }

  for (const row of matrix) {
    it(`new_lead + ${row.label} → NO Family A in every cell (RULE L-2)`, () => {
      const state = evaluate(
        stateFacts({
          salesStage: "new_lead",
          createdAt: hkDaysAgoIso(40),
          lastValidFollowUpAt: row.days === null ? null : hkDaysAgoIso(row.days),
        }),
      );
      assert.equal(
        state.churnRisk.families.includes("ENGAGEMENT_DETERIORATION"),
        false,
      );
      assert.equal(state.churnRisk.level, "low");
    });
  }

  it("fires Family A for every churn-eligible stage and no other", () => {
    for (const stage of ACTIVE_SLA_STAGES) {
      const eligible = (
        DEFAULT_CUSTOMER_STATE_RULES.stageClasses.churnEligible as readonly string[]
      ).includes(stage);
      const severe = DEFAULT_CUSTOMER_STATE_RULES.stageSla[stage].severeDays;
      const state = evaluate(
        stateFacts({
          salesStage: stage,
          lastValidFollowUpAt: hkDaysAgoIso(severe),
          reclamationCycleStartedAt: hkDaysAgoIso(0),
        }),
      );
      assert.equal(state.engagementHealth.state, "silent");
      assert.equal(
        state.churnRisk.families.includes("ENGAGEMENT_DETERIORATION"),
        eligible,
        stage,
      );
    }
  });
});

describe("R1-K / R2 §E — Family B integer day-60 / day-61 boundary", () => {
  // `now` fixed at 2026-08-16 12:00 HK. Day difference 60 → local date
  // 2026-06-17; difference 61 → 2026-06-16.
  const now = hkInstant(2026, 8, 16, 12);
  const lastValid = hkInstant(2025, 1, 1, 12).toISOString();

  function familyBFired(followUpTime: string): boolean {
    const state = computeCustomerState(
      stateFacts({
        salesStage: "contacted",
        lastValidFollowUpAt: lastValid,
        reclamationCycleStartedAt: now.toISOString(),
        followUpOutcomes: [
          outcome("no_contact", followUpTime),
          outcome("no_contact", followUpTime),
          outcome("no_contact", followUpTime),
        ],
      }),
      DEFAULT_CUSTOMER_STATE_RULES,
      now,
    );
    return state.churnRisk.families.includes("REPEATED_NON_RESPONSE");
  }

  it("includes the first instant of the day-60 local date", () => {
    const firstInstant = hkInstant(2026, 6, 17, 0, 0, 0, 0);
    assert.equal(
      getFamilyBDayDifference(firstInstant, now),
      60,
      "sanity: difference is 60",
    );
    assert.equal(familyBFired(firstInstant.toISOString()), true);
  });

  it("excludes the instant one millisecond before that midnight (day 61)", () => {
    const lastInstantOfDay61 = hkInstant(2026, 6, 16, 23, 59, 59, 999);
    assert.equal(getFamilyBDayDifference(lastInstantOfDay61, now), 61);
    assert.equal(familyBFired(lastInstantOfDay61.toISOString()), false);
  });

  it("includes the end of the day-60 local date", () => {
    assert.equal(
      familyBFired(hkInstant(2026, 6, 17, 23, 59, 59, 999).toISOString()),
      true,
    );
  });

  it("excludes a future record (negative difference)", () => {
    assert.equal(
      familyBFired(hkInstant(2026, 8, 17, 12).toISOString()),
      false,
    );
  });

  it("includes a record dated today (difference 0)", () => {
    assert.equal(familyBFired(hkInstant(2026, 8, 16, 9).toISOString()), true);
  });

  it("measures the window in the configured business timezone", () => {
    // 2026-06-17 00:30 HK is still 2026-06-16 in UTC, moving it out of the window.
    const followUpTime = hkInstant(2026, 6, 17, 0, 30).toISOString();
    const records = [
      outcome("no_contact", followUpTime),
      outcome("no_contact", followUpTime),
      outcome("no_contact", followUpTime),
    ];
    const hk = computeCustomerState(
      stateFacts({
        salesStage: "contacted",
        lastValidFollowUpAt: lastValid,
        reclamationCycleStartedAt: now.toISOString(),
        followUpOutcomes: records,
      }),
      DEFAULT_CUSTOMER_STATE_RULES,
      now,
    );
    const utc = computeCustomerState(
      stateFacts({
        salesStage: "contacted",
        lastValidFollowUpAt: lastValid,
        reclamationCycleStartedAt: now.toISOString(),
        followUpOutcomes: records,
        businessTimezone: "UTC",
      }),
      DEFAULT_CUSTOMER_STATE_RULES,
      now,
    );
    assert.equal(
      hk.churnRisk.families.includes("REPEATED_NON_RESPONSE"),
      true,
    );
    assert.equal(
      utc.churnRisk.families.includes("REPEATED_NON_RESPONSE"),
      false,
    );
  });
});

/** Local mirror of the window arithmetic, used only to prove the fixtures. */
function getFamilyBDayDifference(followUpTime: Date, now: Date): number {
  const offset = 8 * 60 * 60 * 1000;
  const toIndex = (instant: Date) =>
    Math.floor((instant.getTime() + offset) / 86_400_000);
  return toIndex(now) - toIndex(followUpTime);
}

describe("R1-N — nextFollowUpAt never leaks into Engagement or Churn", () => {
  const nextActionVariants = [
    { label: "absent", nextFollowUpAt: null },
    { label: "passed 1h ago", nextFollowUpAt: hkDaysAgoIso(0) },
    { label: "passed 5d ago", nextFollowUpAt: hkDaysAgoIso(5) },
    { label: "future 1d", nextFollowUpAt: hkDaysAgoIso(-1) },
    { label: "future 30d", nextFollowUpAt: hkDaysAgoIso(-30) },
    { label: "malformed", nextFollowUpAt: "not-a-date" },
  ];

  for (const days of [3, 8, 15, 25]) {
    it(`contacted at ${days}d — Engagement and Churn ignore every nextFollowUpAt variant`, () => {
      const baseline = evaluate(
        stateFacts({
          salesStage: "contacted",
          lastValidFollowUpAt: hkDaysAgoIso(days),
          reclamationCycleStartedAt: hkDaysAgoIso(0),
        }),
      );
      for (const variant of nextActionVariants) {
        const state = evaluate(
          stateFacts({
            salesStage: "contacted",
            lastValidFollowUpAt: hkDaysAgoIso(days),
            reclamationCycleStartedAt: hkDaysAgoIso(0),
            nextFollowUpAt: variant.nextFollowUpAt,
          }),
        );
        assert.deepEqual(
          state.engagementHealth,
          baseline.engagementHealth,
          `engagement / ${variant.label}`,
        );
        assert.deepEqual(
          state.churnRisk,
          baseline.churnRisk,
          `churn / ${variant.label}`,
        );
      }
    });
  }

  it("never lets a future nextFollowUpAt soften overdue or severe_overdue", () => {
    for (const days of [15, 25]) {
      const state = evaluate(
        stateFacts({
          salesStage: "contacted",
          lastValidFollowUpAt: hkDaysAgoIso(days),
          reclamationCycleStartedAt: hkDaysAgoIso(0),
          nextFollowUpAt: hkDaysAgoIso(-30),
        }),
      );
      assert.equal(
        state.followUpSla.state,
        days >= 21 ? "severe_overdue" : "overdue",
      );
    }
  });

  it("caps a passed nextFollowUpAt at due_soon", () => {
    const state = evaluate(
      stateFacts({
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(1),
        nextFollowUpAt: hkDaysAgoIso(1),
      }),
    );
    assert.equal(state.followUpSla.state, "due_soon");
    assert.equal(state.engagementHealth.state, "active");
    assert.equal(state.churnRisk.level, "low");
    assert.equal(state.attentionLevel.level, "normal");
  });
});

describe("Reclamation and Churn are semantically independent (RULE N-1, N-4, J-2)", () => {
  it("keeps Churn identical across reclamation-only fact changes", () => {
    const baseline = evaluate(
      stateFacts({
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(20),
      }),
    );
    const variants: Partial<CustomerStateFacts>[] = [
      { isPinned: 1 },
      { hasCollaborator: true },
      { automaticReclaimDays: 8 },
      { automaticReclaimDays: 365 },
      { reclaimRuleGraceUntil: hkDaysAgoIso(-1) },
    ];
    for (const variant of variants) {
      const state = evaluate(
        stateFacts({
          salesStage: "contacted",
          lastValidFollowUpAt: hkDaysAgoIso(20),
          ...variant,
        }),
      );
      assert.deepEqual(state.churnRisk, baseline.churnRisk);
      assert.deepEqual(state.engagementHealth, baseline.engagementHealth);
      assert.deepEqual(state.followUpSla, baseline.followUpSla);
    }
  });

  it("keeps Reclamation identical across churn-only fact changes", () => {
    const base = {
      salesStage: "contacted",
      lastValidFollowUpAt: hkDaysAgoIso(49),
    } as const;
    const baseline = evaluate(stateFacts(base));
    assert.equal(baseline.reclamationRisk.state, "warning");
    for (const outcomes of [
      repeatOutcome("no_contact", 5, 5),
      repeatOutcome("no_reply", 5, 5),
      [outcome("lost_contact", hkDaysAgoIso(1))],
    ]) {
      const state = evaluate(
        stateFacts({ ...base, followUpOutcomes: outcomes }),
      );
      assert.deepEqual(state.reclamationRisk, baseline.reclamationRisk);
    }
  });

  it("exempts reclamation without touching SLA or Churn (scenarios 55, 56)", () => {
    for (const variant of [{ isPinned: 1 }, { hasCollaborator: true }]) {
      const state = evaluate(
        stateFacts({
          salesStage: "contacted",
          lastValidFollowUpAt: hkDaysAgoIso(52),
          ...variant,
        }),
      );
      assert.equal(state.reclamationRisk.state, "exempt");
      assert.equal(state.followUpSla.state, "severe_overdue");
      assert.equal(state.churnRisk.level, "medium");
    }
  });
});
