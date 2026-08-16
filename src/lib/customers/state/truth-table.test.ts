/**
 * TASK 17-C1 — Y-1 pure engine, Y-3 state reachability.
 *
 * Executes the complete corrected scenario truth table from TASK 17-B-R1 §Y
 * (70 scenarios) against the canonical evaluator, plus the §Y enum-conformance
 * and reachability checks (RULE G-7: `complete` and `incomplete` are
 * production-empty but MUST remain structurally reachable).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeCustomerState } from "./engine";
import type { CustomerStateReasonCode } from "./reason-codes";
import { DEFAULT_CUSTOMER_STATE_RULES } from "./rules";
import {
  ATTENTION_LEVELS,
  CHURN_LEVELS,
  ENGAGEMENT_STATES,
  FIRST_CONTACT_STATES,
  FOLLOW_UP_SLA_STATES,
  PROFILE_VERDICTS,
  RECLAMATION_RISK_STATES,
  type AttentionLevel,
  type ChurnLevel,
  type CustomerStateFacts,
  type EngagementState,
  type FirstContactState,
  type FollowUpSlaState,
  type ProfileVerdict,
  type ReclamationRiskState,
} from "./types";
import {
  NOW,
  coreProfile,
  completeProfile,
  hkDaysAgoIso,
  hoursAgoIso,
  msAgoIso,
  outcome,
  repeatOutcome,
  stateFacts,
} from "./state-fixtures.test-helper";

type Expectation = {
  fc?: FirstContactState;
  sla?: FollowUpSlaState;
  eng?: EngagementState;
  churn?: ChurnLevel;
  recl?: ReclamationRiskState;
  attn?: AttentionLevel;
  prof?: ProfileVerdict;
  /** Typed against the closed registry so a mistyped scenario fails to compile. */
  reasons?: CustomerStateReasonCode[];
  absentReasons?: CustomerStateReasonCode[];
};

type Scenario = {
  id: number;
  label: string;
  facts: CustomerStateFacts;
  expect: Expectation;
};

/** Scenario 32–40: non-response records recorded after a 12-day-old interaction. */
function contactedWithNonResponse(
  records: ReturnType<typeof repeatOutcome>,
): CustomerStateFacts {
  return stateFacts({
    salesStage: "contacted",
    lastValidFollowUpAt: hkDaysAgoIso(12),
    followUpOutcomes: records,
  });
}

const SCENARIOS: Scenario[] = [
  {
    id: 1,
    label: "new_lead, never valid, age 12h",
    facts: stateFacts({ createdAt: hoursAgoIso(12) }),
    expect: {
      fc: "normal",
      sla: "not_started",
      eng: "not_started",
      churn: "low",
      recl: "none",
      attn: "low",
      reasons: ["SLA_NOT_STARTED", "CHURN_NOT_APPLICABLE_NO_PRIOR_ENGAGEMENT"],
    },
  },
  {
    id: 2,
    label: "new_lead, never valid, age exactly 24.000h",
    facts: stateFacts({ createdAt: hoursAgoIso(24) }),
    expect: { fc: "normal", attn: "low" },
  },
  {
    id: 3,
    label: "new_lead, never valid, age 24h + 1ms",
    facts: stateFacts({ createdAt: msAgoIso(24 * 3_600_000 + 1) }),
    expect: {
      fc: "due_soon",
      attn: "normal",
      reasons: ["FIRST_CONTACT_DUE_SOON", "ATTENTION_NORMAL_FIRST_CONTACT"],
    },
  },
  {
    id: 4,
    label: "new_lead, never valid, age exactly 48.000h",
    facts: stateFacts({ createdAt: hoursAgoIso(48) }),
    expect: { fc: "due_soon", attn: "normal" },
  },
  {
    id: 5,
    label: "new_lead, never valid, age 48h + 1ms",
    facts: stateFacts({ createdAt: msAgoIso(48 * 3_600_000 + 1) }),
    expect: { fc: "overdue", attn: "high", reasons: ["FIRST_CONTACT_OVERDUE"] },
  },
  {
    id: 6,
    label: "new_lead, never valid, age exactly 72.000h",
    facts: stateFacts({ createdAt: hoursAgoIso(72) }),
    expect: { fc: "overdue", attn: "high" },
  },
  {
    id: 7,
    label: "new_lead, never valid, age 72h + 1ms",
    facts: stateFacts({ createdAt: msAgoIso(72 * 3_600_000 + 1) }),
    expect: {
      fc: "critical",
      attn: "urgent",
      reasons: ["FIRST_CONTACT_CRITICAL", "ATTENTION_URGENT_FIRST_CONTACT"],
    },
  },
  {
    id: 8,
    label: "new_lead, valid exactly 2d ago (Target inclusive)",
    facts: stateFacts({ lastValidFollowUpAt: hkDaysAgoIso(2) }),
    expect: {
      fc: "not_applicable",
      sla: "on_track",
      eng: "active",
      churn: "low",
      recl: "none",
      attn: "low",
    },
  },
  {
    id: 9,
    label: "new_lead, valid exactly 3d ago (Warning 3)",
    facts: stateFacts({ lastValidFollowUpAt: hkDaysAgoIso(3) }),
    expect: {
      fc: "not_applicable",
      sla: "due_soon",
      eng: "stable",
      churn: "low",
      attn: "high",
      reasons: ["SLA_WARNING_REACHED", "ATTENTION_HIGH_SLA_WARNING"],
    },
  },
  {
    id: 10,
    label: "new_lead, valid exactly 5d ago — new_lead is not churn-eligible",
    facts: stateFacts({ lastValidFollowUpAt: hkDaysAgoIso(5) }),
    expect: { sla: "overdue", eng: "cooling", churn: "low", attn: "high" },
  },
  {
    id: 11,
    label: "new_lead, valid exactly 10d ago — silence is SLA failure, never churn",
    facts: stateFacts({ lastValidFollowUpAt: hkDaysAgoIso(10) }),
    expect: {
      sla: "severe_overdue",
      eng: "silent",
      churn: "low",
      attn: "urgent",
    },
  },
  {
    id: 12,
    label: "contacted, valid 3d ago",
    facts: stateFacts({
      salesStage: "contacted",
      lastValidFollowUpAt: hkDaysAgoIso(3),
    }),
    expect: {
      sla: "on_track",
      eng: "active",
      churn: "low",
      recl: "none",
      attn: "low",
    },
  },
  {
    id: 13,
    label: "contacted, valid 8d ago — stable ⇒ no Family A",
    facts: stateFacts({
      salesStage: "contacted",
      lastValidFollowUpAt: hkDaysAgoIso(8),
    }),
    expect: {
      sla: "due_soon",
      eng: "stable",
      churn: "low",
      attn: "high",
      reasons: ["SLA_STAGE_TARGET_EXCEEDED", "SLA_WARNING_REACHED"],
    },
  },
  {
    id: 14,
    label: "contacted, valid 15d ago — Family A applies to contacted",
    facts: stateFacts({
      salesStage: "contacted",
      lastValidFollowUpAt: hkDaysAgoIso(15),
    }),
    expect: {
      sla: "overdue",
      eng: "cooling",
      churn: "medium",
      attn: "high",
      reasons: ["CHURN_ENGAGEMENT_DETERIORATION"],
    },
  },
  {
    id: 15,
    label: "contacted, valid 25d ago",
    facts: stateFacts({
      salesStage: "contacted",
      lastValidFollowUpAt: hkDaysAgoIso(25),
    }),
    expect: {
      sla: "severe_overdue",
      eng: "silent",
      churn: "medium",
      attn: "urgent",
    },
  },
  {
    id: 16,
    label: "negotiation, valid exactly 3d ago",
    facts: stateFacts({
      salesStage: "negotiation",
      lastValidFollowUpAt: hkDaysAgoIso(3),
    }),
    expect: { sla: "on_track", eng: "active", churn: "low", attn: "low" },
  },
  {
    id: 17,
    label: "negotiation, valid 4d ago — 4 < Warning 5",
    facts: stateFacts({
      salesStage: "negotiation",
      lastValidFollowUpAt: hkDaysAgoIso(4),
    }),
    expect: {
      sla: "due_soon",
      eng: "stable",
      churn: "low",
      attn: "normal",
      reasons: ["SLA_STAGE_TARGET_EXCEEDED", "ATTENTION_NORMAL_SLA_DUE_SOON"],
      absentReasons: ["SLA_WARNING_REACHED"],
    },
  },
  {
    id: 18,
    label: "negotiation, valid exactly 5d ago — Warning 5",
    facts: stateFacts({
      salesStage: "negotiation",
      lastValidFollowUpAt: hkDaysAgoIso(5),
    }),
    expect: {
      sla: "due_soon",
      eng: "stable",
      attn: "high",
      reasons: ["SLA_WARNING_REACHED"],
    },
  },
  {
    id: 19,
    label: "negotiation, valid exactly 7d ago",
    facts: stateFacts({
      salesStage: "negotiation",
      lastValidFollowUpAt: hkDaysAgoIso(7),
    }),
    expect: {
      sla: "overdue",
      eng: "cooling",
      churn: "medium",
      attn: "high",
      reasons: ["SLA_OVERDUE", "ATTENTION_HIGH_CHURN_HIGH_INTENT"],
    },
  },
  {
    id: 20,
    label: "negotiation, valid exactly 14d ago",
    facts: stateFacts({
      salesStage: "negotiation",
      lastValidFollowUpAt: hkDaysAgoIso(14),
    }),
    expect: {
      sla: "severe_overdue",
      eng: "silent",
      churn: "medium",
      attn: "urgent",
      reasons: ["SLA_OVERDUE_SEVERE", "ENGAGEMENT_SILENT"],
    },
  },
  {
    id: 21,
    label: "interested, valid exactly 14d ago",
    facts: stateFacts({
      salesStage: "interested",
      lastValidFollowUpAt: hkDaysAgoIso(14),
    }),
    expect: { sla: "overdue", eng: "cooling", churn: "medium", attn: "high" },
  },
  {
    id: 22,
    label: "interested, valid exactly 28d ago",
    facts: stateFacts({
      salesStage: "interested",
      lastValidFollowUpAt: hkDaysAgoIso(28),
    }),
    expect: {
      sla: "severe_overdue",
      eng: "silent",
      churn: "medium",
      attn: "urgent",
    },
  },
  {
    id: 23,
    label: "proposal, valid exactly 10d ago",
    facts: stateFacts({
      salesStage: "proposal",
      lastValidFollowUpAt: hkDaysAgoIso(10),
    }),
    expect: { sla: "overdue", eng: "cooling", churn: "medium", attn: "high" },
  },
  {
    id: 24,
    label: "on_hold, nextFollowUpAt in past, valid 4d ago",
    facts: stateFacts({
      salesStage: "on_hold",
      lastValidFollowUpAt: hkDaysAgoIso(4),
      nextFollowUpAt: hkDaysAgoIso(1),
    }),
    expect: {
      fc: "deferred",
      sla: "deferred",
      eng: "deferred",
      churn: "low",
      recl: "exempt",
      attn: "low",
      reasons: ["DEFERRAL_ON_HOLD", "CHURN_DEFERRED", "RECLAMATION_EXEMPT"],
      absentReasons: ["SLA_NEXT_ACTION_OVERDUE"],
    },
  },
  {
    id: 25,
    label: "on_hold, nextFollowUpAt in future",
    facts: stateFacts({
      salesStage: "on_hold",
      lastValidFollowUpAt: hkDaysAgoIso(4),
      nextFollowUpAt: hkDaysAgoIso(-7),
    }),
    expect: {
      fc: "deferred",
      sla: "deferred",
      eng: "deferred",
      churn: "low",
      recl: "exempt",
      attn: "low",
      reasons: ["DEFERRAL_ON_HOLD"],
    },
  },
  {
    id: 26,
    label: "on_hold, valid 20d ago, not_interested recorded after",
    facts: stateFacts({
      salesStage: "on_hold",
      lastValidFollowUpAt: hkDaysAgoIso(20),
      followUpOutcomes: [outcome("not_interested", hkDaysAgoIso(10))],
    }),
    expect: {
      fc: "deferred",
      sla: "deferred",
      eng: "deferred",
      churn: "high",
      recl: "exempt",
      attn: "urgent",
      reasons: ["CHURN_NOT_INTERESTED", "ATTENTION_URGENT_CHURN"],
      absentReasons: ["CHURN_DEFERRED"],
    },
  },
  {
    id: 27,
    label: "contacted, valid 2d ago, nextFollowUpAt in 30d",
    facts: stateFacts({
      salesStage: "contacted",
      lastValidFollowUpAt: hkDaysAgoIso(2),
      nextFollowUpAt: hkDaysAgoIso(-30),
    }),
    expect: { sla: "on_track", eng: "active", churn: "low", attn: "low" },
  },
  {
    id: 28,
    label: "contacted, valid 2d ago, nextFollowUpAt in 1d",
    facts: stateFacts({
      salesStage: "contacted",
      lastValidFollowUpAt: hkDaysAgoIso(2),
      nextFollowUpAt: hkDaysAgoIso(-1),
    }),
    expect: { sla: "on_track", eng: "active", churn: "low", attn: "low" },
  },
  {
    id: 29,
    label: "contacted, valid 2d ago, nextFollowUpAt passed 1h ago",
    facts: stateFacts({
      salesStage: "contacted",
      lastValidFollowUpAt: hkDaysAgoIso(2),
      nextFollowUpAt: hoursAgoIso(1),
    }),
    expect: {
      sla: "due_soon",
      eng: "active",
      churn: "low",
      attn: "normal",
      reasons: ["SLA_NEXT_ACTION_OVERDUE"],
      absentReasons: ["SLA_STAGE_TARGET_EXCEEDED", "SLA_WARNING_REACHED"],
    },
  },
  {
    id: 30,
    label: "contacted, valid 25d ago, nextFollowUpAt in 30d — cannot soften",
    facts: stateFacts({
      salesStage: "contacted",
      lastValidFollowUpAt: hkDaysAgoIso(25),
      nextFollowUpAt: hkDaysAgoIso(-30),
    }),
    expect: {
      sla: "severe_overdue",
      eng: "silent",
      churn: "medium",
      attn: "urgent",
    },
  },
  {
    id: 31,
    label: "negotiation, never valid, age 30d",
    facts: stateFacts({
      salesStage: "negotiation",
      createdAt: hkDaysAgoIso(30),
    }),
    expect: {
      fc: "critical",
      sla: "not_started",
      eng: "not_started",
      churn: "low",
      recl: "none",
      attn: "urgent",
      reasons: ["CHURN_NOT_APPLICABLE_NO_PRIOR_ENGAGEMENT"],
    },
  },
  {
    id: 32,
    label: "contacted, valid 12d ago, 1× no_reply after — Family B false",
    facts: contactedWithNonResponse(repeatOutcome("no_reply", 1, 5)),
    expect: {
      sla: "overdue",
      eng: "cooling",
      churn: "medium",
      attn: "high",
      absentReasons: ["CHURN_REPEATED_NON_RESPONSE"],
    },
  },
  {
    id: 33,
    label: "contacted, valid 12d ago, 2× no_reply after — A + B",
    facts: contactedWithNonResponse(repeatOutcome("no_reply", 2, 5)),
    expect: {
      churn: "high",
      attn: "urgent",
      reasons: [
        "CHURN_ENGAGEMENT_DETERIORATION",
        "CHURN_REPEATED_NON_RESPONSE",
      ],
    },
  },
  {
    id: 34,
    label: "contacted, valid 12d ago, 3× no_reply — B still ONE family",
    facts: contactedWithNonResponse(repeatOutcome("no_reply", 3, 5)),
    expect: { churn: "high", attn: "urgent" },
  },
  {
    id: 35,
    label: "contacted, valid 12d ago, 1× no_contact — Family B false",
    facts: contactedWithNonResponse(repeatOutcome("no_contact", 1, 5)),
    expect: { churn: "medium", attn: "high" },
  },
  {
    id: 36,
    label: "contacted, valid 12d ago, 2× no_contact — Family B false (needs 3)",
    facts: contactedWithNonResponse(repeatOutcome("no_contact", 2, 5)),
    expect: {
      churn: "medium",
      attn: "high",
      absentReasons: ["CHURN_REPEATED_NON_RESPONSE"],
    },
  },
  {
    id: 37,
    label: "contacted, valid 12d ago, 3× no_contact — A + B",
    facts: contactedWithNonResponse(repeatOutcome("no_contact", 3, 5)),
    expect: {
      churn: "high",
      attn: "urgent",
      reasons: ["CHURN_REPEATED_NON_RESPONSE"],
    },
  },
  {
    id: 38,
    label: "contacted, valid 12d ago, 4× no_contact — still exactly two families",
    facts: contactedWithNonResponse(repeatOutcome("no_contact", 4, 5)),
    expect: { churn: "high", attn: "urgent" },
  },
  {
    id: 39,
    label: "contacted, valid 12d ago, 1× no_reply + 1× no_contact — mixed false",
    facts: contactedWithNonResponse([
      ...repeatOutcome("no_reply", 1, 5),
      ...repeatOutcome("no_contact", 1, 7),
    ]),
    expect: {
      churn: "medium",
      attn: "high",
      absentReasons: ["CHURN_REPEATED_NON_RESPONSE"],
    },
  },
  {
    id: 40,
    label: "contacted, valid 12d ago, 1× no_reply + 2× no_contact — mixed true",
    facts: contactedWithNonResponse([
      ...repeatOutcome("no_reply", 1, 5),
      ...repeatOutcome("no_contact", 2, 7),
    ]),
    expect: {
      churn: "high",
      attn: "urgent",
      reasons: ["CHURN_REPEATED_NON_RESPONSE"],
    },
  },
  {
    id: 41,
    label: "contacted, valid 3d ago, 3× no_contact after — Family B isolated",
    facts: stateFacts({
      salesStage: "contacted",
      lastValidFollowUpAt: hkDaysAgoIso(3),
      followUpOutcomes: repeatOutcome("no_contact", 3, 0),
    }),
    expect: {
      sla: "on_track",
      eng: "active",
      churn: "medium",
      attn: "normal",
      reasons: ["CHURN_REPEATED_NON_RESPONSE", "ATTENTION_NORMAL_CHURN"],
      absentReasons: ["CHURN_ENGAGEMENT_DETERIORATION"],
    },
  },
  {
    id: 42,
    label: "contacted, 3× no_contact all at or before lastValidFollowUpAt",
    facts: stateFacts({
      salesStage: "contacted",
      lastValidFollowUpAt: hkDaysAgoIso(3),
      followUpOutcomes: repeatOutcome("no_contact", 3, 3),
    }),
    expect: {
      sla: "on_track",
      eng: "active",
      churn: "low",
      attn: "low",
      absentReasons: ["CHURN_REPEATED_NON_RESPONSE"],
    },
  },
  {
    id: 43,
    label: "contacted, 3× no_contact 70 business-calendar days ago",
    facts: stateFacts({
      salesStage: "contacted",
      lastValidFollowUpAt: hkDaysAgoIso(80),
      // Ownership cycle reset 5 days ago (e.g. approved transfer), which keeps
      // Reclamation at `none` exactly as the truth table row states.
      reclamationCycleStartedAt: hkDaysAgoIso(5),
      followUpOutcomes: repeatOutcome("no_contact", 3, 70),
    }),
    expect: {
      sla: "severe_overdue",
      eng: "silent",
      churn: "medium",
      recl: "none",
      attn: "urgent",
      absentReasons: ["CHURN_REPEATED_NON_RESPONSE"],
    },
  },
  {
    id: 44,
    label: "interested, valid 30d ago, lost_contact recorded after",
    facts: stateFacts({
      salesStage: "interested",
      lastValidFollowUpAt: hkDaysAgoIso(30),
      followUpOutcomes: [outcome("lost_contact", hkDaysAgoIso(10))],
    }),
    expect: {
      sla: "severe_overdue",
      eng: "silent",
      churn: "high",
      recl: "none",
      attn: "urgent",
      reasons: ["CHURN_LOST_CONTACT"],
    },
  },
  {
    id: 45,
    label: "contacted, valid 3d ago, not_interested 10d before it — superseded",
    facts: stateFacts({
      salesStage: "contacted",
      lastValidFollowUpAt: hkDaysAgoIso(3),
      followUpOutcomes: [outcome("not_interested", hkDaysAgoIso(13))],
    }),
    expect: {
      sla: "on_track",
      eng: "active",
      churn: "low",
      attn: "low",
      absentReasons: ["CHURN_NOT_INTERESTED"],
    },
  },
  {
    id: 46,
    label: "contacted, valid 12d ago, not_interested recorded after",
    facts: stateFacts({
      salesStage: "contacted",
      lastValidFollowUpAt: hkDaysAgoIso(12),
      followUpOutcomes: [outcome("not_interested", hkDaysAgoIso(5))],
    }),
    expect: {
      sla: "overdue",
      eng: "cooling",
      churn: "high",
      attn: "urgent",
      reasons: ["CHURN_NOT_INTERESTED"],
    },
  },
  {
    id: 47,
    label: "negotiation, valid 20d ago, plus 3× no_contact after",
    facts: stateFacts({
      salesStage: "negotiation",
      lastValidFollowUpAt: hkDaysAgoIso(20),
      followUpOutcomes: repeatOutcome("no_contact", 3, 5),
    }),
    expect: {
      sla: "severe_overdue",
      eng: "silent",
      churn: "high",
      recl: "none",
      attn: "urgent",
    },
  },
  {
    id: 48,
    label: "negotiation, valid 20d ago, no non-response records",
    facts: stateFacts({
      salesStage: "negotiation",
      lastValidFollowUpAt: hkDaysAgoIso(20),
    }),
    expect: {
      sla: "severe_overdue",
      eng: "silent",
      churn: "medium",
      attn: "urgent",
    },
  },
  {
    id: 49,
    label: "contacted, never valid, 3× no_contact recorded, age 40d",
    facts: stateFacts({
      salesStage: "contacted",
      createdAt: hkDaysAgoIso(40),
      followUpOutcomes: repeatOutcome("no_contact", 3, 5),
    }),
    expect: {
      fc: "critical",
      sla: "not_started",
      eng: "not_started",
      churn: "low",
      recl: "none",
      attn: "urgent",
      reasons: ["CHURN_NOT_APPLICABLE_NO_PRIOR_ENGAGEMENT"],
      absentReasons: ["CHURN_REPEATED_NON_RESPONSE"],
    },
  },
  {
    id: 50,
    label: "contacted, never valid, age 40d, no follow-up records",
    facts: stateFacts({
      salesStage: "contacted",
      createdAt: hkDaysAgoIso(40),
    }),
    expect: {
      fc: "critical",
      sla: "not_started",
      eng: "not_started",
      churn: "low",
      recl: "none",
      attn: "urgent",
      reasons: ["CHURN_NOT_APPLICABLE_NO_PRIOR_ENGAGEMENT"],
    },
  },
  {
    id: 51,
    label: "closed_won, never valid, age 90d",
    facts: stateFacts({
      salesStage: "closed_won",
      createdAt: hkDaysAgoIso(90),
    }),
    expect: {
      fc: "exempt",
      sla: "exempt",
      eng: "exempt",
      churn: "low",
      recl: "exempt",
      attn: "low",
      reasons: ["CHURN_NOT_APPLICABLE_POST_SALE"],
    },
  },
  {
    id: 52,
    label: "paid, valid 60d ago — exempt precedes not_applicable",
    facts: stateFacts({
      salesStage: "paid",
      lastValidFollowUpAt: hkDaysAgoIso(60),
    }),
    expect: {
      fc: "exempt",
      sla: "exempt",
      eng: "exempt",
      churn: "low",
      recl: "exempt",
      attn: "low",
      absentReasons: ["FIRST_CONTACT_NOT_APPLICABLE"],
    },
  },
  {
    id: 53,
    label: "closed_lost, valid 40d ago — not reclamation-exempt today",
    facts: stateFacts({
      salesStage: "closed_lost",
      lastValidFollowUpAt: hkDaysAgoIso(40),
    }),
    expect: {
      fc: "exempt",
      sla: "exempt",
      eng: "exempt",
      churn: "low",
      recl: "none",
      attn: "low",
      reasons: ["CHURN_NOT_APPLICABLE_CLOSED_LOST"],
    },
  },
  {
    id: 54,
    label: "Public Pool customer (status=public_pool, ownerId null)",
    facts: stateFacts({
      salesStage: "contacted",
      status: "public_pool",
      ownerId: null,
      profile: completeProfile(),
    }),
    expect: {
      fc: "exempt",
      sla: "exempt",
      eng: "exempt",
      churn: "low",
      recl: "exempt",
      attn: "low",
      prof: "complete",
      reasons: ["CHURN_NOT_APPLICABLE_UNOWNED"],
    },
  },
  {
    id: 55,
    label: "contacted, valid 20d ago, 1 collaborator",
    facts: stateFacts({
      salesStage: "contacted",
      lastValidFollowUpAt: hkDaysAgoIso(20),
      hasCollaborator: true,
    }),
    expect: {
      fc: "not_applicable",
      sla: "overdue",
      eng: "cooling",
      churn: "medium",
      recl: "exempt",
      attn: "high",
      reasons: ["RECLAMATION_EXEMPT"],
    },
  },
  {
    id: 56,
    label: "contacted, isPinned=1, valid 52d ago",
    facts: stateFacts({
      salesStage: "contacted",
      isPinned: 1,
      lastValidFollowUpAt: hkDaysAgoIso(52),
    }),
    expect: {
      sla: "severe_overdue",
      eng: "silent",
      churn: "medium",
      recl: "exempt",
      attn: "urgent",
    },
  },
  {
    id: 57,
    label: "contacted, valid 49d ago — daysRemaining 6",
    facts: stateFacts({
      salesStage: "contacted",
      lastValidFollowUpAt: hkDaysAgoIso(49),
    }),
    expect: {
      sla: "severe_overdue",
      eng: "silent",
      churn: "medium",
      recl: "warning",
      attn: "urgent",
    },
  },
  {
    id: 58,
    label: "contacted, valid exactly 54d ago — daysRemaining 1",
    facts: stateFacts({
      salesStage: "contacted",
      lastValidFollowUpAt: hkDaysAgoIso(54),
    }),
    expect: { recl: "final", attn: "urgent" },
  },
  {
    id: 59,
    label: "contacted, valid 56d ago — reclamation due",
    facts: stateFacts({
      salesStage: "contacted",
      lastValidFollowUpAt: hkDaysAgoIso(56),
    }),
    expect: { recl: "due", attn: "urgent", reasons: ["RECLAMATION_DUE"] },
  },
  {
    id: 60,
    label: "nameStatus=pending, all other fields filled",
    facts: stateFacts({
      profile: completeProfile({ nameStatus: "pending" }),
    }),
    expect: {
      prof: "critical_gaps",
      reasons: ["PROFILE_REQUIRED_IDENTITY_MISSING"],
    },
  },
  {
    id: 61,
    label: "REQUIRED met, CORE_NEED_CAPTURED and CORE_CONTEXT both unmet",
    facts: stateFacts({
      profile: coreProfile({ requestedProjectCode: null, notes: null }),
    }),
    expect: {
      prof: "incomplete",
      reasons: [
        "PROFILE_CORE_NEED_NOT_CAPTURED",
        "PROFILE_CORE_CONTEXT_MISSING",
      ],
    },
  },
  {
    id: 62,
    label: "all groups met, negotiation, valid 20d ago",
    facts: stateFacts({
      salesStage: "negotiation",
      lastValidFollowUpAt: hkDaysAgoIso(20),
      profile: completeProfile(),
    }),
    expect: {
      sla: "severe_overdue",
      eng: "silent",
      churn: "medium",
      recl: "none",
      attn: "urgent",
      prof: "complete",
    },
  },
  {
    id: 63,
    label: "unknown stage 'foo', valid 5d ago, idle 5d",
    facts: stateFacts({
      salesStage: "foo",
      lastValidFollowUpAt: hkDaysAgoIso(5),
    }),
    expect: {
      fc: "exempt",
      sla: "exempt",
      eng: "exempt",
      churn: "low",
      recl: "none",
      attn: "low",
      reasons: [
        "STATE_STAGE_UNKNOWN",
        "FIRST_CONTACT_EXEMPT",
        "SLA_EXEMPT",
        "ENGAGEMENT_EXEMPT",
        "CHURN_NOT_APPLICABLE_STAGE_UNKNOWN",
      ],
    },
  },
  {
    id: 64,
    label: "unknown stage 'foo', idle 49d — reclamation still escalates",
    facts: stateFacts({
      salesStage: "foo",
      lastValidFollowUpAt: hkDaysAgoIso(49),
    }),
    expect: {
      fc: "exempt",
      sla: "exempt",
      eng: "exempt",
      churn: "low",
      recl: "warning",
      attn: "high",
      reasons: ["ATTENTION_HIGH_RECLAMATION"],
    },
  },
  {
    id: 65,
    label: 'lastValidFollowUpAt = "not-a-date" — treated as absent',
    facts: stateFacts({ lastValidFollowUpAt: "not-a-date" }),
    expect: {
      fc: "normal",
      sla: "not_started",
      eng: "not_started",
      churn: "low",
      recl: "none",
      attn: "low",
    },
  },
  {
    id: 66,
    label: "legacy stage negotiating, valid exactly 8d ago",
    facts: stateFacts({
      salesStage: "negotiating",
      lastValidFollowUpAt: hkDaysAgoIso(8),
    }),
    expect: {
      fc: "not_applicable",
      sla: "overdue",
      eng: "cooling",
      churn: "medium",
      recl: "none",
      attn: "high",
      absentReasons: ["STATE_STAGE_UNKNOWN"],
    },
  },
  {
    id: 67,
    label: "legacy stage negotiating, valid exactly 14d ago",
    facts: stateFacts({
      salesStage: "negotiating",
      lastValidFollowUpAt: hkDaysAgoIso(14),
    }),
    expect: {
      sla: "severe_overdue",
      eng: "silent",
      churn: "medium",
      attn: "urgent",
    },
  },
  {
    id: 68,
    label: "claimed out of Public Pool 6h ago, never valid",
    facts: stateFacts({
      salesStage: "new_lead",
      createdAt: hkDaysAgoIso(20),
      reclamationCycleStartedAt: hoursAgoIso(6),
    }),
    expect: {
      fc: "normal",
      sla: "not_started",
      eng: "not_started",
      churn: "low",
      recl: "none",
      attn: "low",
      reasons: ["FIRST_CONTACT_ANCHOR_REASSIGNED"],
    },
  },
  {
    id: 69,
    label: "transferred to new owner 4d ago, never valid, created 60d ago",
    facts: stateFacts({
      salesStage: "contacted",
      createdAt: hkDaysAgoIso(60),
      reclamationCycleStartedAt: hkDaysAgoIso(4),
    }),
    expect: {
      fc: "critical",
      sla: "not_started",
      eng: "not_started",
      churn: "low",
      recl: "none",
      attn: "urgent",
      reasons: ["FIRST_CONTACT_ANCHOR_REASSIGNED"],
    },
  },
  {
    id: 70,
    label: "stage changed from on_hold to contacted; valid 30d ago",
    facts: stateFacts({
      salesStage: "contacted",
      lastValidFollowUpAt: hkDaysAgoIso(30),
    }),
    expect: {
      fc: "not_applicable",
      sla: "severe_overdue",
      eng: "silent",
      churn: "medium",
      attn: "urgent",
      absentReasons: ["DEFERRAL_ON_HOLD"],
    },
  },
];

describe("Y-1 — TASK 17-B-R1 §Y scenario truth table", () => {
  it("covers all 70 specified scenarios exactly once", () => {
    assert.equal(SCENARIOS.length, 70);
    assert.deepEqual(
      SCENARIOS.map((scenario) => scenario.id),
      Array.from({ length: 70 }, (_, index) => index + 1),
    );
  });

  for (const scenario of SCENARIOS) {
    it(`scenario ${scenario.id} — ${scenario.label}`, () => {
      const state = computeCustomerState(
        scenario.facts,
        DEFAULT_CUSTOMER_STATE_RULES,
        NOW,
      );
      const codes = state.reasons.map((entry) => entry.code);
      const expected = scenario.expect;

      if (expected.fc) {
        assert.equal(state.firstContact.state, expected.fc, "firstContact");
      }
      if (expected.sla) {
        assert.equal(state.followUpSla.state, expected.sla, "followUpSla");
      }
      if (expected.eng) {
        assert.equal(
          state.engagementHealth.state,
          expected.eng,
          "engagementHealth",
        );
      }
      if (expected.churn) {
        assert.equal(state.churnRisk.level, expected.churn, "churnRisk");
      }
      if (expected.recl) {
        assert.equal(
          state.reclamationRisk.state,
          expected.recl,
          "reclamationRisk",
        );
      }
      if (expected.attn) {
        assert.equal(
          state.attentionLevel.level,
          expected.attn,
          "attentionLevel",
        );
      }
      if (expected.prof) {
        assert.equal(
          state.profileCompleteness.verdict,
          expected.prof,
          "profileCompleteness",
        );
      }
      for (const code of expected.reasons ?? []) {
        assert.ok(codes.includes(code), `expected reason ${code} in ${codes}`);
      }
      for (const code of expected.absentReasons ?? []) {
        assert.ok(!codes.includes(code), `unexpected reason ${code}`);
      }
    });
  }

  it("never produces a value outside its dimension enum (§Y enum check)", () => {
    for (const scenario of SCENARIOS) {
      const state = computeCustomerState(
        scenario.facts,
        DEFAULT_CUSTOMER_STATE_RULES,
        NOW,
      );
      assert.ok(FIRST_CONTACT_STATES.includes(state.firstContact.state));
      assert.ok(FOLLOW_UP_SLA_STATES.includes(state.followUpSla.state));
      assert.ok(ENGAGEMENT_STATES.includes(state.engagementHealth.state));
      assert.ok(CHURN_LEVELS.includes(state.churnRisk.level));
      assert.ok(RECLAMATION_RISK_STATES.includes(state.reclamationRisk.state));
      assert.ok(ATTENTION_LEVELS.includes(state.attentionLevel.level));
      assert.ok(PROFILE_VERDICTS.includes(state.profileCompleteness.verdict));
    }
  });
});

/**
 * Reachability fixtures for states the §Y table does not happen to exercise.
 * Reclamation `approaching` needs 7 < daysRemaining <= 14, i.e. idle 41–47 of 55.
 */
const EXTRA_REACHABILITY_FACTS: CustomerStateFacts[] = [
  stateFacts({
    salesStage: "contacted",
    lastValidFollowUpAt: hkDaysAgoIso(45),
  }),
];

describe("Y-3 — every declared state is structurally reachable", () => {
  const observed = {
    firstContact: new Set<FirstContactState>(),
    followUpSla: new Set<FollowUpSlaState>(),
    engagement: new Set<EngagementState>(),
    churn: new Set<ChurnLevel>(),
    reclamation: new Set<ReclamationRiskState>(),
    attention: new Set<AttentionLevel>(),
    profile: new Set<ProfileVerdict>(),
  };

  for (const facts of [
    ...SCENARIOS.map((scenario) => scenario.facts),
    ...EXTRA_REACHABILITY_FACTS,
  ]) {
    const state = computeCustomerState(facts, DEFAULT_CUSTOMER_STATE_RULES, NOW);
    observed.firstContact.add(state.firstContact.state);
    observed.followUpSla.add(state.followUpSla.state);
    observed.engagement.add(state.engagementHealth.state);
    observed.churn.add(state.churnRisk.level);
    observed.reclamation.add(state.reclamationRisk.state);
    observed.attention.add(state.attentionLevel.level);
    observed.profile.add(state.profileCompleteness.verdict);
  }

  // RULE G-7 — `complete` and `incomplete` are production-empty today but MUST
  // remain reachable; scenarios 54/62 and 61 supply the synthetic fixtures.
  it("reaches every First Contact state", () => {
    assert.deepEqual([...observed.firstContact].sort(), [
      ...FIRST_CONTACT_STATES,
    ].sort());
  });
  it("reaches every Follow-up SLA state", () => {
    assert.deepEqual([...observed.followUpSla].sort(), [
      ...FOLLOW_UP_SLA_STATES,
    ].sort());
  });
  it("reaches every Engagement state", () => {
    assert.deepEqual([...observed.engagement].sort(), [
      ...ENGAGEMENT_STATES,
    ].sort());
  });
  it("reaches every Churn level", () => {
    assert.deepEqual([...observed.churn].sort(), [...CHURN_LEVELS].sort());
  });
  it("reaches every Attention level", () => {
    assert.deepEqual([...observed.attention].sort(), [
      ...ATTENTION_LEVELS,
    ].sort());
  });
  it("reaches every Reclamation state", () => {
    assert.deepEqual([...observed.reclamation].sort(), [
      ...RECLAMATION_RISK_STATES,
    ].sort());
  });
  it("reaches every Profile verdict including complete and incomplete", () => {
    assert.deepEqual([...observed.profile].sort(), [
      ...PROFILE_VERDICTS,
    ].sort());
  });
});
