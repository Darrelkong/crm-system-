/**
 * SQL expressions mirroring each Customer State Engine V2 dimension (TASK 17-C2).
 *
 * Source of truth remains the pure JS engine; these fragments exist only for
 * D1-side filtering and counting.
 */

import { sql, type SQL } from "drizzle-orm";
import * as schema from "../../../../drizzle/schema";
import { buildDaysWithoutValidSql } from "@/lib/customers/scoring/scoring-sql-primitives";
import type { CustomerStateRules } from "./rules";
import {
  DEFAULT_CUSTOMER_STATE_RULES,
  getStageSlaRule,
} from "./rules";
import type {
  AttentionLevel,
  ChurnLevel,
  EngagementState,
  FirstContactState,
  FollowUpSlaState,
  ProfileVerdict,
  ReclamationRiskState,
} from "./types";
import {
  buildActiveSlaStageFromStageSql,
  buildChurnEligibleStageFromStageSql,
  buildHighIntentStageFromStageSql,
  buildReclamationIdleDaysSql,
  buildSharedStateSqlFragments,
  buildStateCalendarDaysSinceSql,
  buildStateElapsedHoursSql,
  buildStateInstantSql,
  buildStateSqlClock,
  buildStateTrimmedSql,
  stateSqlFieldHasText,
  type StateSqlClock,
} from "./state-sql-primitives";

const c = schema.customers;

export type StateDimensionColumns = {
  profileVerdict: SQL;
  profileScore: SQL;
  firstContact: SQL;
  followUpSla: SQL;
  engagement: SQL;
  churnLevel: SQL;
  reclamationRisk: SQL;
  attentionLevel: SQL;
  slaWarningReached: SQL;
};

function buildProfileGroupMetSql(): Record<string, SQL> {
  const nameConfirmed = sql`(
    ${stateSqlFieldHasText(c.customerName)}
    AND ${buildStateTrimmedSql(c.nameStatus)} = 'confirmed'
  )`;
  const phone = stateSqlFieldHasText(c.phone);
  const wechat = stateSqlFieldHasText(c.wechatId);
  const email = stateSqlFieldHasText(c.email);
  const reachable = sql`(${phone} OR ${wechat} OR ${email})`;
  const primaryChannel = sql`(${phone} OR ${wechat})`;
  const needCaptured = sql`(
    ${stateSqlFieldHasText(c.requestedProjectCode)}
    OR ${stateSqlFieldHasText(c.primaryConcern)}
  )`;
  const context = sql`(
    ${stateSqlFieldHasText(c.notes)}
    OR ${stateSqlFieldHasText(c.targetCountryOrRegion)}
  )`;
  const channelCount = sql`(
    (CASE WHEN ${phone} THEN 1 ELSE 0 END)
    + (CASE WHEN ${wechat} THEN 1 ELSE 0 END)
    + (CASE WHEN ${email} THEN 1 ELSE 0 END)
  )`;
  const demographics = sql`(
    ${stateSqlFieldHasText(c.preferredName)}
    OR ${stateSqlFieldHasText(c.gender)}
    OR ${stateSqlFieldHasText(c.ageRange)}
    OR ${stateSqlFieldHasText(c.preferredLanguage)}
  )`;
  const professional = sql`(
    ${stateSqlFieldHasText(c.occupation)}
    OR ${stateSqlFieldHasText(c.companyName)}
    OR ${stateSqlFieldHasText(c.jobTitle)}
  )`;

  return {
    REQ_IDENTITY: nameConfirmed,
    REQ_REACHABLE: reachable,
    CORE_PRIMARY_CHANNEL: primaryChannel,
    CORE_NEED_CAPTURED: needCaptured,
    CORE_CONTEXT: context,
    OPT_SECOND_CHANNEL: sql`${channelCount} >= 2`,
    OPT_EMAIL: email,
    OPT_PREFERRED_CONTACT: stateSqlFieldHasText(c.preferredContactMethod),
    OPT_DEMOGRAPHICS: demographics,
    OPT_PROFESSIONAL: professional,
  };
}

export function buildProfileScoreSql(
  rules: CustomerStateRules = DEFAULT_CUSTOMER_STATE_RULES,
): SQL {
  const groups = buildProfileGroupMetSql();
  const parts = [
    ...rules.completeness.requiredGroups,
    ...rules.completeness.coreGroups,
    ...rules.completeness.optionalGroups,
  ].map(
    (group) =>
      sql`(CASE WHEN ${groups[group]} THEN ${rules.completeness.weights[group]} ELSE 0 END)`,
  );
  return sql`(${sql.join(parts, sql` + `)})`;
}

export function buildProfileVerdictSql(
  rules: CustomerStateRules = DEFAULT_CUSTOMER_STATE_RULES,
): SQL {
  const g = buildProfileGroupMetSql();
  const missingRequired = sql.join(
    rules.completeness.requiredGroups.map(
      (group) => sql`(CASE WHEN ${g[group]} THEN 0 ELSE 1 END)`,
    ),
    sql` + `,
  );
  const missingCore = sql.join(
    rules.completeness.coreGroups.map(
      (group) => sql`(CASE WHEN ${g[group]} THEN 0 ELSE 1 END)`,
    ),
    sql` + `,
  );
  const missingOptional = sql.join(
    rules.completeness.optionalGroups.map(
      (group) => sql`(CASE WHEN ${g[group]} THEN 0 ELSE 1 END)`,
    ),
    sql` + `,
  );
  return sql`CASE
    WHEN (${missingRequired}) > 0 THEN 'critical_gaps'
    WHEN (${missingCore}) >= 2 THEN 'incomplete'
    WHEN (${missingCore}) = 1 OR (${missingOptional}) >= 1 THEN 'minor_gaps'
    ELSE 'complete'
  END`;
}

export type StateFactRefs = {
  stage: SQL;
  parsedLastValid: SQL;
  parsedNextFollowUp: SQL;
  daysSinceValid: SQL;
  reclamationIdleDays: SQL;
  reclamationExempt: SQL;
  noReplyCount: SQL;
  noContactCount: SQL;
  familyC: SQL;
  /** Precomputed first-contact anchor age in hours (facts CTE). */
  fcAgeHours?: SQL;
  thresholdTarget?: SQL;
  thresholdWarning?: SQL;
  thresholdOverdue?: SQL;
  thresholdSevere?: SQL;
};

export function buildStateCoreDimensionSql(
  refs: StateFactRefs,
  rules: CustomerStateRules,
  clock: StateSqlClock,
  automaticReclaimDays: number,
): {
  profileVerdict: SQL;
  firstContact: SQL;
  followUpSla: SQL;
  engagement: SQL;
  churnLevel: SQL;
  reclamationRisk: SQL;
  slaWarningReached: SQL;
} {
  const thresholds = {
    target:
      refs.thresholdTarget ??
      buildStageThresholdCaseSql(refs.stage, "targetDays", rules),
    warning:
      refs.thresholdWarning ??
      buildStageThresholdCaseSql(refs.stage, "warningDays", rules),
    overdue:
      refs.thresholdOverdue ??
      buildStageThresholdCaseSql(refs.stage, "overdueDays", rules),
    severe:
      refs.thresholdSevere ??
      buildStageThresholdCaseSql(refs.stage, "severeDays", rules),
  };
  const engagement = buildEngagementStateFromShared(rules, refs, thresholds);
  return {
    profileVerdict: buildProfileVerdictSql(rules),
    firstContact: buildFirstContactStateFromShared(rules, clock, refs),
    followUpSla: buildFollowUpSlaStateFromShared(rules, clock, refs, thresholds),
    engagement,
    churnLevel: buildChurnLevelFromShared(rules, refs, engagement),
    reclamationRisk: buildReclamationRiskFromShared(automaticReclaimDays, refs),
    slaWarningReached: buildSlaWarningReachedFromShared(rules, refs, thresholds),
  };
}

export function buildStateAttentionSqlFromCore(
  refs: StateFactRefs,
  core: {
    firstContact: SQL;
    followUpSla: SQL;
    reclamationRisk: SQL;
    churnLevel: SQL;
    slaWarningReached: SQL;
  },
): SQL {
  const highIntent = buildHighIntentStageFromStageSql(refs.stage);
  return sql`CASE
    WHEN ${core.firstContact} = 'critical'
      OR ${core.followUpSla} = 'severe_overdue'
      OR ${core.reclamationRisk} IN ('final', 'due')
      OR ${core.churnLevel} = 'high' THEN 'urgent'
    WHEN ${core.firstContact} = 'overdue'
      OR ${core.followUpSla} = 'overdue'
      OR ${core.reclamationRisk} = 'warning'
      OR (${core.churnLevel} = 'medium' AND ${highIntent})
      OR ${core.slaWarningReached} = 1 THEN 'high'
    WHEN ${core.firstContact} = 'due_soon'
      OR ${core.followUpSla} = 'due_soon'
      OR ${core.reclamationRisk} = 'approaching'
      OR (${core.churnLevel} = 'medium' AND NOT ${highIntent}) THEN 'normal'
    ELSE 'low'
  END`;
}

export function buildStateDimensionColumnsFromFactRefs(
  refs: StateFactRefs,
  rules: CustomerStateRules,
  clock: StateSqlClock,
  automaticReclaimDays: number,
): StateDimensionColumns {
  const core = buildStateCoreDimensionSql(
    refs,
    rules,
    clock,
    automaticReclaimDays,
  );
  return {
    ...core,
    profileScore: buildProfileScoreSql(rules),
    attentionLevel: buildStateAttentionSqlFromCore(refs, core),
    slaWarningReached: core.slaWarningReached,
  };
}

type StageThresholdSql = {
  target: SQL;
  warning: SQL;
  overdue: SQL;
  severe: SQL;
};

function buildFirstContactStateFromShared(
  rules: CustomerStateRules,
  clock: StateSqlClock,
  shared: StateFactRefs,
): SQL {
  const anchorRaw = sql`CASE
    WHEN ${stateSqlFieldHasText(c.reclamationCycleStartedAt)}
      THEN ${buildStateInstantSql(c.reclamationCycleStartedAt)}
    ELSE ${buildStateInstantSql(c.createdAt)}
  END`;
  const ageHours =
    shared.fcAgeHours ?? buildStateElapsedHoursSql(anchorRaw, clock);
  const { dueSoonHours, overdueHours, criticalHours } = rules.firstContact;
  const { stage, parsedLastValid } = shared;
  const anchorMissing =
    shared.fcAgeHours !== undefined
      ? sql`${shared.fcAgeHours} IS NULL`
      : sql`${anchorRaw} IS NULL`;

  return sql`CASE
    WHEN ${stage} IN ('closed_won', 'paid', 'closed_lost') OR ${stage} = 'unknown'
      OR ${c.ownerId} IS NULL OR ${c.status} = 'public_pool' THEN 'exempt'
    WHEN ${stage} = 'on_hold' THEN 'deferred'
    WHEN ${parsedLastValid} IS NOT NULL THEN 'not_applicable'
    WHEN ${anchorMissing} THEN 'normal'
    WHEN ${ageHours} <= ${sql.raw(String(dueSoonHours))} THEN 'normal'
    WHEN ${ageHours} <= ${sql.raw(String(overdueHours))} THEN 'due_soon'
    WHEN ${ageHours} <= ${sql.raw(String(criticalHours))} THEN 'overdue'
    ELSE 'critical'
  END`;
}

function buildStageThresholdCaseSql(
  stageColumn: SQL,
  field: "targetDays" | "warningDays" | "overdueDays" | "severeDays",
  rules: CustomerStateRules,
): SQL {
  return sql`CASE ${stageColumn}
    WHEN 'new_lead' THEN ${sql.raw(String(getStageSlaRule(rules, "new_lead")[field]))}
    WHEN 'contacted' THEN ${sql.raw(String(getStageSlaRule(rules, "contacted")[field]))}
    WHEN 'interested' THEN ${sql.raw(String(getStageSlaRule(rules, "interested")[field]))}
    WHEN 'proposal' THEN ${sql.raw(String(getStageSlaRule(rules, "proposal")[field]))}
    WHEN 'negotiation' THEN ${sql.raw(String(getStageSlaRule(rules, "negotiation")[field]))}
    ELSE NULL
  END`;
}

function buildEngagementStateFromShared(
  rules: CustomerStateRules,
  shared: StateFactRefs,
  thresholds: StageThresholdSql,
): SQL {
  const { stage, daysSinceValid } = shared;
  const activeStage = buildActiveSlaStageFromStageSql(stage);

  return sql`CASE
    WHEN ${stage} IN ('closed_won', 'paid', 'closed_lost') OR ${stage} = 'unknown'
      OR ${c.ownerId} IS NULL OR ${c.status} = 'public_pool' THEN 'exempt'
    WHEN ${stage} = 'on_hold' THEN 'deferred'
    WHEN ${daysSinceValid} IS NULL THEN 'not_started'
    WHEN NOT ${activeStage} THEN 'exempt'
    WHEN ${daysSinceValid} >= ${thresholds.severe} THEN 'silent'
    WHEN ${daysSinceValid} >= ${thresholds.overdue} THEN 'cooling'
    WHEN ${daysSinceValid} > ${thresholds.target} THEN 'stable'
    ELSE 'active'
  END`;
}

export function buildStageThresholdColumnsSql(
  stageColumn: SQL,
  rules: CustomerStateRules = DEFAULT_CUSTOMER_STATE_RULES,
): {
  target: SQL;
  warning: SQL;
  overdue: SQL;
  severe: SQL;
} {
  return {
    target: buildStageThresholdCaseSql(stageColumn, "targetDays", rules),
    warning: buildStageThresholdCaseSql(stageColumn, "warningDays", rules),
    overdue: buildStageThresholdCaseSql(stageColumn, "overdueDays", rules),
    severe: buildStageThresholdCaseSql(stageColumn, "severeDays", rules),
  };
}

function buildFollowUpSlaStateFromShared(
  rules: CustomerStateRules,
  clock: StateSqlClock,
  shared: StateFactRefs,
  thresholds: StageThresholdSql,
): SQL {
  const { stage, daysSinceValid, parsedNextFollowUp } = shared;
  const activeStage = buildActiveSlaStageFromStageSql(stage);
  const nextOverdue = sql`(
    ${parsedNextFollowUp} IS NOT NULL
    AND julianday(${parsedNextFollowUp}) < julianday(${clock.nowIsoRaw})
  )`;

  return sql`CASE
    WHEN ${stage} IN ('closed_won', 'paid', 'closed_lost') OR ${stage} = 'unknown'
      OR ${c.ownerId} IS NULL OR ${c.status} = 'public_pool' THEN 'exempt'
    WHEN ${stage} = 'on_hold' THEN 'deferred'
    WHEN ${daysSinceValid} IS NULL THEN 'not_started'
    WHEN NOT ${activeStage} THEN 'exempt'
    WHEN ${daysSinceValid} >= ${thresholds.severe} THEN 'severe_overdue'
    WHEN ${daysSinceValid} >= ${thresholds.overdue} THEN 'overdue'
    WHEN ${daysSinceValid} > ${thresholds.target} THEN 'due_soon'
    WHEN ${nextOverdue} THEN 'due_soon'
    ELSE 'on_track'
  END`;
}

function buildSlaWarningReachedFromShared(
  rules: CustomerStateRules,
  shared: StateFactRefs,
  thresholds: StageThresholdSql,
): SQL {
  const { daysSinceValid } = shared;

  return sql`CASE
    WHEN ${daysSinceValid} IS NULL THEN 0
    WHEN ${daysSinceValid} > ${thresholds.target}
      AND ${daysSinceValid} < ${thresholds.overdue}
      AND ${daysSinceValid} >= ${thresholds.warning} THEN 1
    ELSE 0
  END`;
}

function buildChurnLevelFromShared(
  rules: CustomerStateRules,
  shared: StateFactRefs,
  engagementState: SQL,
): SQL {
  const { stage, parsedLastValid, noReplyCount, noContactCount, familyC } = shared;
  const churn = rules.churn;
  const familyB = sql`CASE
    WHEN ${noReplyCount} >= ${sql.raw(String(churn.noReplyMinCount))} THEN 1
    WHEN ${noContactCount} >= ${sql.raw(String(churn.noContactMinCount))} THEN 1
    WHEN ${noReplyCount} >= ${sql.raw(String(churn.mixedNoReplyMinCount))}
      AND ${noContactCount} >= ${sql.raw(String(churn.mixedNoContactMinCount))} THEN 1
    ELSE 0
  END`;
  const churnEligible = buildChurnEligibleStageFromStageSql(stage);
  const familyA = sql`CASE
    WHEN ${churnEligible}
      AND ${parsedLastValid} IS NOT NULL
      AND ${engagementState} IN ('cooling', 'silent') THEN 1
    ELSE 0
  END`;
  const nonDecisive = sql`(CASE WHEN ${familyA} = 1 THEN 1 ELSE 0 END + CASE WHEN ${familyB} = 1 THEN 1 ELSE 0 END)`;

  return sql`CASE
    WHEN ${stage} IN ('closed_won', 'paid') THEN 'low'
    WHEN ${stage} = 'closed_lost' THEN 'low'
    WHEN ${stage} = 'unknown' THEN 'low'
    WHEN ${c.ownerId} IS NULL OR ${c.status} = 'public_pool' THEN 'low'
    WHEN ${parsedLastValid} IS NULL THEN 'low'
    WHEN ${familyC} = 1 THEN 'high'
    WHEN ${nonDecisive} >= 2 THEN 'high'
    WHEN ${stage} = 'on_hold' THEN 'low'
    WHEN ${nonDecisive} = 1 THEN 'medium'
    ELSE 'low'
  END`;
}

function buildReclamationRiskFromShared(
  automaticReclaimDays: number,
  shared: StateFactRefs,
): SQL {
  const { reclamationIdleDays: idleDays, reclamationExempt } = shared;
  const daysRemaining = sql`(${sql.raw(String(automaticReclaimDays))} - ${idleDays})`;

  return sql`CASE
    WHEN ${reclamationExempt} = 1 THEN 'exempt'
    WHEN ${idleDays} >= ${sql.raw(String(automaticReclaimDays))} THEN 'due'
    WHEN ${daysRemaining} <= 1 THEN 'final'
    WHEN ${daysRemaining} <= 7 THEN 'warning'
    WHEN ${daysRemaining} <= 14 THEN 'approaching'
    ELSE 'none'
  END`;
}

function buildAttentionLevelFromShared(
  shared: StateFactRefs,
  firstContactSql: SQL,
  slaSql: SQL,
  reclamationSql: SQL,
  churnSql: SQL,
  slaWarningSql: SQL,
): SQL {
  const highIntent = buildHighIntentStageFromStageSql(shared.stage);
  // Flatten nested dimension SQL by comparing precomputed alias columns in filter
  // queries; for dimension projection keep the cascade on scalar subresults.
  return sql`CASE
    WHEN ${firstContactSql} = 'critical'
      OR ${slaSql} = 'severe_overdue'
      OR ${reclamationSql} IN ('final', 'due')
      OR ${churnSql} = 'high' THEN 'urgent'
    WHEN ${firstContactSql} = 'overdue'
      OR ${slaSql} = 'overdue'
      OR ${reclamationSql} = 'warning'
      OR (${churnSql} = 'medium' AND ${highIntent})
      OR ${slaWarningSql} = 1 THEN 'high'
    WHEN ${firstContactSql} = 'due_soon'
      OR ${slaSql} = 'due_soon'
      OR ${reclamationSql} = 'approaching'
      OR (${churnSql} = 'medium' AND NOT ${highIntent}) THEN 'normal'
    ELSE 'low'
  END`;
}

export function buildStateDimensionColumns(
  options: {
    rules?: CustomerStateRules;
    clock: StateSqlClock;
    automaticReclaimDays?: number;
  },
): StateDimensionColumns {
  const rules = options.rules ?? DEFAULT_CUSTOMER_STATE_RULES;
  const clock = options.clock;
  const automaticReclaimDays = options.automaticReclaimDays ?? 55;

  const shared = buildSharedStateSqlFragments(clock);
  const refs: StateFactRefs = shared;
  const thresholds = {
    target: buildStageThresholdCaseSql(refs.stage, "targetDays", rules),
    warning: buildStageThresholdCaseSql(refs.stage, "warningDays", rules),
    overdue: buildStageThresholdCaseSql(refs.stage, "overdueDays", rules),
    severe: buildStageThresholdCaseSql(refs.stage, "severeDays", rules),
  };
  const engagement = buildEngagementStateFromShared(rules, refs, thresholds);
  const firstContact = buildFirstContactStateFromShared(rules, clock, refs);
  const followUpSla = buildFollowUpSlaStateFromShared(
    rules,
    clock,
    refs,
    thresholds,
  );
  const slaWarningReached = buildSlaWarningReachedFromShared(
    rules,
    refs,
    thresholds,
  );
  const churnLevel = buildChurnLevelFromShared(rules, refs, engagement);
  const reclamationRisk = buildReclamationRiskFromShared(
    automaticReclaimDays,
    refs,
  );
  const attentionLevel = buildAttentionLevelFromShared(
    refs,
    firstContact,
    followUpSla,
    reclamationRisk,
    churnLevel,
    slaWarningReached,
  );

  return {
    profileVerdict: buildProfileVerdictSql(rules),
    profileScore: buildProfileScoreSql(rules),
    firstContact,
    followUpSla,
    engagement,
    churnLevel,
    reclamationRisk,
    attentionLevel,
    slaWarningReached,
  };
}

export type StateListFilter = {
  profileVerdict?: ProfileVerdict;
  firstContact?: FirstContactState;
  followUpSla?: FollowUpSlaState;
  engagement?: EngagementState;
  churnLevel?: ChurnLevel;
  reclamationRisk?: ReclamationRiskState;
  attentionLevel?: AttentionLevel;
};

export function buildStateListFilterSql(
  filter: StateListFilter,
  columns: StateDimensionColumns,
): SQL | undefined {
  return buildStateListFilterOnAliasesSql(filter);
}

export function buildStateListFilterOnAliasesSql(
  filter: StateListFilter,
): SQL | undefined {
  const clauses: SQL[] = [];
  if (filter.profileVerdict !== undefined) {
    clauses.push(sql`state_profile_verdict = ${filter.profileVerdict}`);
  }
  if (filter.firstContact !== undefined) {
    clauses.push(sql`state_first_contact = ${filter.firstContact}`);
  }
  if (filter.followUpSla !== undefined) {
    clauses.push(sql`state_follow_up_sla = ${filter.followUpSla}`);
  }
  if (filter.engagement !== undefined) {
    clauses.push(sql`state_engagement = ${filter.engagement}`);
  }
  if (filter.churnLevel !== undefined) {
    clauses.push(sql`state_churn_level = ${filter.churnLevel}`);
  }
  if (filter.reclamationRisk !== undefined) {
    clauses.push(sql`state_reclamation_risk = ${filter.reclamationRisk}`);
  }
  if (filter.attentionLevel !== undefined) {
    clauses.push(sql`state_attention_level = ${filter.attentionLevel}`);
  }
  if (clauses.length === 0) return undefined;
  return sql.join(clauses, sql` AND `);
}

/** Exposed for tests verifying reclamation idle parity with frozen helper. */
export function buildStateReclamationIdleDaysSql(clock: StateSqlClock): SQL {
  return buildDaysWithoutValidSql(clock.now);
}

export {
  buildNormalizedStageSql,
  buildStateSqlClock,
  buildStateCalendarDaysSinceSql,
  buildParsedLastValidSql,
} from "./state-sql-primitives";
