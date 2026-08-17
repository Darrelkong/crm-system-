/**
 * Shared D1 CTE builders for per-dimension state SQL (C2).
 */

import { sql, type SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../../drizzle/schema";
import type { BusinessTimezone } from "@/lib/settings/effective";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";
import { DEFAULT_CUSTOMER_STATE_RULES, type CustomerStateRules } from "./rules";
import {
  buildProfileVerdictSql,
  buildStageThresholdColumnsSql,
  type StateFactRefs,
} from "./state-sql-dimensions";
import {
  buildChurnFamilyCSql,
  buildChurnOutcomeCountSql,
  buildNormalizedStageSql,
  buildParsedLastValidSql,
  buildParsedNextFollowUpSql,
  buildStateCalendarDaysSinceSql,
  buildStateElapsedHoursSql,
  buildStateInstantSql,
  buildStateSqlClock,
  stateSqlFieldHasText,
  type StateSqlClock,
} from "./state-sql-primitives";

type Database = ReturnType<typeof drizzle<typeof schema>>;
const c = schema.customers;

export type StateDimensionQueryOptions = {
  rules?: CustomerStateRules;
  now: Date;
  businessTimezone?: BusinessTimezone;
  automaticReclaimDays?: number;
};

export function resolveContext(options: StateDimensionQueryOptions) {
  const timezone = options.businessTimezone ?? HONG_KONG_TIMEZONE;
  return {
    clock: buildStateSqlClock(options.now, timezone),
    rules: options.rules ?? DEFAULT_CUSTOMER_STATE_RULES,
    automaticReclaimDays: options.automaticReclaimDays ?? 55,
  };
}

function buildFirstContactAnchorSql(): SQL {
  return sql`CASE
    WHEN ${stateSqlFieldHasText(c.reclamationCycleStartedAt)}
      THEN ${buildStateInstantSql(c.reclamationCycleStartedAt)}
    ELSE ${buildStateInstantSql(c.createdAt)}
  END`;
}

function buildThresholdRefs(
  stage: SQL,
  rules: CustomerStateRules,
): Pick<
  StateFactRefs,
  "thresholdTarget" | "thresholdWarning" | "thresholdOverdue" | "thresholdSevere"
> {
  const thresholds = buildStageThresholdColumnsSql(stage, rules);
  return {
    thresholdTarget: thresholds.target,
    thresholdWarning: thresholds.warning,
    thresholdOverdue: thresholds.overdue,
    thresholdSevere: thresholds.severe,
  };
}

export function buildSlaFactsCte(
  db: Database,
  cteName: string,
  clock: StateSqlClock,
  rules: CustomerStateRules,
  scopeWhere: SQL | undefined,
  includeNextFollowUp: boolean,
) {
  const stage = buildNormalizedStageSql();
  const parsedLastValid = buildParsedLastValidSql();
  const daysSinceValid = sql`CASE
    WHEN ${parsedLastValid} IS NULL THEN NULL
    ELSE ${buildStateCalendarDaysSinceSql(parsedLastValid, clock)}
  END`;
  const thresholds = buildThresholdRefs(stage, rules);

  let query = db
    .select({
      id: c.id,
      stage: sql<string>`${stage}`.as("stage"),
      parsedLastValid: sql<string | null>`${parsedLastValid}`.as(
        "parsed_last_valid",
      ),
      parsedNextFollowUp: includeNextFollowUp
        ? sql<string | null>`${buildParsedNextFollowUpSql()}`.as(
            "parsed_next_follow_up",
          )
        : sql<string | null>`NULL`.as("parsed_next_follow_up"),
      daysSinceValid: sql<number | null>`${daysSinceValid}`.as(
        "days_since_valid",
      ),
      thresholdTarget: sql<number | null>`${thresholds.thresholdTarget}`.as(
        "threshold_target",
      ),
      thresholdWarning: sql<number | null>`${thresholds.thresholdWarning}`.as(
        "threshold_warning",
      ),
      thresholdOverdue: sql<number | null>`${thresholds.thresholdOverdue}`.as(
        "threshold_overdue",
      ),
      thresholdSevere: sql<number | null>`${thresholds.thresholdSevere}`.as(
        "threshold_severe",
      ),
    })
    .from(c);
  if (scopeWhere) query = query.where(scopeWhere) as typeof query;
  return db.$with(cteName).as(query);
}

export function buildFirstContactFactsCte(
  db: Database,
  cteName: string,
  clock: StateSqlClock,
  scopeWhere: SQL | undefined,
) {
  const stage = buildNormalizedStageSql();
  const parsedLastValid = buildParsedLastValidSql();
  const fcAnchor = buildFirstContactAnchorSql();
  const fcAgeHours = sql`CASE
    WHEN ${fcAnchor} IS NULL THEN NULL
    ELSE ${buildStateElapsedHoursSql(fcAnchor, clock)}
  END`;

  let query = db
    .select({
      id: c.id,
      stage: sql<string>`${stage}`.as("stage"),
      parsedLastValid: sql<string | null>`${parsedLastValid}`.as(
        "parsed_last_valid",
      ),
      fcAgeHours: sql<number | null>`${fcAgeHours}`.as("fc_age_hours"),
    })
    .from(c);
  if (scopeWhere) query = query.where(scopeWhere) as typeof query;
  return db.$with(cteName).as(query);
}

export function buildChurnFactsCte(
  db: Database,
  slaCteName: string,
  churnCteName: string,
  clock: StateSqlClock,
  rules: CustomerStateRules,
  scopeWhere: SQL | undefined,
  includeNextFollowUp = false,
) {
  const slaFacts = buildSlaFactsCte(
    db,
    slaCteName,
    clock,
    rules,
    scopeWhere,
    includeNextFollowUp,
  );
  const parsedLastValid = sql`${slaFacts.parsedLastValid}`;
  const churnCte = db.$with(churnCteName).as(
    db
      .select({
        id: slaFacts.id,
        noReplyCount: sql<number>`${buildChurnOutcomeCountSql(
          parsedLastValid,
          clock,
          60,
          "'no_reply'",
          sql`${slaFacts.id}`,
        )}`.as("no_reply_count"),
        noContactCount: sql<number>`${buildChurnOutcomeCountSql(
          parsedLastValid,
          clock,
          60,
          "'no_contact'",
          sql`${slaFacts.id}`,
        )}`.as("no_contact_count"),
        familyC: sql<number>`${buildChurnFamilyCSql(
          parsedLastValid,
          sql`${slaFacts.id}`,
        )}`.as("family_c"),
      })
      .from(slaFacts),
  );
  return { slaFacts, churnCte };
}

export function refsFromSlaFacts(
  facts: ReturnType<typeof buildSlaFactsCte>,
  churn?: ReturnType<typeof buildChurnFactsCte>["churnCte"],
): StateFactRefs {
  return {
    stage: sql`${facts.stage}`,
    parsedLastValid: sql`${facts.parsedLastValid}`,
    parsedNextFollowUp: sql`${facts.parsedNextFollowUp}`,
    daysSinceValid: sql`${facts.daysSinceValid}`,
    reclamationIdleDays: sql`0`,
    reclamationExempt: sql`0`,
    noReplyCount: churn?.noReplyCount ? sql`${churn.noReplyCount}` : sql`0`,
    noContactCount: churn?.noContactCount ? sql`${churn.noContactCount}` : sql`0`,
    familyC: churn?.familyC ? sql`${churn.familyC}` : sql`0`,
    thresholdTarget: sql`${facts.thresholdTarget}`,
    thresholdWarning: sql`${facts.thresholdWarning}`,
    thresholdOverdue: sql`${facts.thresholdOverdue}`,
    thresholdSevere: sql`${facts.thresholdSevere}`,
  };
}

export function refsFromFirstContactFacts(
  facts: ReturnType<typeof buildFirstContactFactsCte>,
): StateFactRefs {
  return {
    stage: sql`${facts.stage}`,
    parsedLastValid: sql`${facts.parsedLastValid}`,
    parsedNextFollowUp: sql`NULL`,
    daysSinceValid: sql`NULL`,
    reclamationIdleDays: sql`0`,
    reclamationExempt: sql`0`,
    noReplyCount: sql`0`,
    noContactCount: sql`0`,
    familyC: sql`0`,
    fcAgeHours: sql`${facts.fcAgeHours}`,
  };
}

export function refsFromReclamationRow(
  idleDays: SQL,
  exempt: SQL,
): StateFactRefs {
  return {
    stage: sql`'new_lead'`,
    parsedLastValid: sql`NULL`,
    parsedNextFollowUp: sql`NULL`,
    daysSinceValid: sql`NULL`,
    reclamationIdleDays: idleDays,
    reclamationExempt: exempt,
    noReplyCount: sql`0`,
    noContactCount: sql`0`,
    familyC: sql`0`,
  };
}

export { buildProfileVerdictSql };
