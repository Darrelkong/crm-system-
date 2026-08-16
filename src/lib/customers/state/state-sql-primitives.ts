/**
 * D1-safe SQL primitives for Customer State Engine V2 mirror (TASK 17-C2).
 *
 * Mirrors JS helpers in `time.ts`, `text.ts`, and `stages.ts`. Reuses
 * `sqlFieldHasText` from legacy scoring when semantics match exactly.
 */

import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import * as schema from "../../../../drizzle/schema";
import { getBusinessDateYmd } from "@/lib/reports/dates";
import { getTimezoneOffsetMs } from "@/lib/reports/dates";
import { sqlFieldHasText } from "@/lib/customers/scoring/scoring-sql-primitives";
import type { BusinessTimezone } from "@/lib/settings/effective";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";
const c = schema.customers;
const fu = schema.followUps;
const ca = schema.customerAssignees;

const AS_INTEGER = sql.raw("AS INTEGER");
const ECMASCRIPT_TRIM_CHARACTERS =
  "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680" +
  "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a" +
  "\u2028\u2029\u202f\u205f\u3000\ufeff";
const ECMASCRIPT_TRIM_SQL = sql.raw(
  `'${ECMASCRIPT_TRIM_CHARACTERS.replace(/'/g, "''")}'`,
);

export function stateSqlFieldHasText(column: AnyColumn | SQL): SQL {
  return sql`(
    ${column} IS NOT NULL
    AND trim(${column}, ${ECMASCRIPT_TRIM_SQL}) <> ''
  )`;
}

export type StateSqlClock = {
  now: Date;
  nowIso: string;
  /** Inlined ISO literal for D1 parameter budget. */
  nowIsoRaw: SQL;
  businessTodayYmd: string;
  /** Inlined YMD literal for D1 parameter budget. */
  businessTodayYmdRaw: SQL;
  /** SQLite datetime modifier, e.g. `'+8 hours'`. */
  tzModifier: SQL;
};

export function buildStateSqlClock(
  now: Date,
  timezone: BusinessTimezone = HONG_KONG_TIMEZONE,
): StateSqlClock {
  const offsetHours = getTimezoneOffsetMs(timezone) / (60 * 60 * 1000);
  const sign = offsetHours >= 0 ? "+" : "-";
  const abs = Math.abs(offsetHours);
  const nowIso = now.toISOString();
  const businessTodayYmd = getBusinessDateYmd(now, timezone);
  return {
    now,
    nowIso,
    nowIsoRaw: sql.raw(`'${nowIso.replace(/'/g, "''")}'`),
    businessTodayYmd,
    businessTodayYmdRaw: sql.raw(`'${businessTodayYmd.replace(/'/g, "''")}'`),
    tzModifier: sql.raw(`'${sign}${abs} hours'`),
  };
}

/** ECMAScript trim parity used by `hasStateText`. */
export function buildStateTrimmedSql(column: AnyColumn | SQL): SQL {
  return sql`trim(${column}, ${ECMASCRIPT_TRIM_SQL})`;
}

/**
 * Mirrors `parseStateInstant`: returns trimmed ISO when calendar-valid, else NULL.
 * Uses SQLite date round-trip to reject impossible calendar dates (C1-F1 parity).
 */
export function buildStateInstantSql(column: AnyColumn | SQL): SQL {
  const trimmed = buildStateTrimmedSql(column);
  const datePart = sql`substr(${trimmed}, 1, 10)`;
  const hasTime = sql`(length(${trimmed}) >= 19 AND substr(${trimmed}, 11, 1) IN ('T', ' '))`;
  const hh = sql`CASE WHEN ${hasTime} THEN CAST(substr(${trimmed}, 12, 2) AS INTEGER) ELSE 0 END`;
  const mm = sql`CASE WHEN ${hasTime} THEN CAST(substr(${trimmed}, 15, 2) AS INTEGER) ELSE 0 END`;
  const ss = sql`CASE WHEN ${hasTime} AND length(${trimmed}) >= 19 THEN CAST(substr(${trimmed}, 18, 2) AS INTEGER) ELSE 0 END`;

  return sql`CASE
    WHEN ${column} IS NULL THEN NULL
    WHEN ${trimmed} = '' OR length(${trimmed}) < 10 THEN NULL
    WHEN substr(${trimmed}, 5, 1) != '-' OR substr(${trimmed}, 8, 1) != '-' THEN NULL
    WHEN CAST(strftime('%m', date(${datePart})) AS INTEGER) != CAST(substr(${trimmed}, 6, 2) AS INTEGER) THEN NULL
    WHEN CAST(strftime('%d', date(${datePart})) AS INTEGER) != CAST(substr(${trimmed}, 9, 2) AS INTEGER) THEN NULL
    WHEN ${hasTime} AND (${hh} > 23 OR ${mm} > 59 OR ${ss} > 59) THEN NULL
    ELSE ${trimmed}
  END`;
}

/** Fractional elapsed hours — mirrors `getElapsedHours`. */
export function buildStateElapsedHoursSql(
  anchorInstant: SQL,
  clock: Pick<StateSqlClock, "nowIsoRaw">,
): SQL {
  return sql`((julianday(${clock.nowIsoRaw}) - julianday(${anchorInstant})) * 24.0)`;
}

/** Business-calendar day difference: local(today) minus local(instant). */
export function buildStateCalendarDaysSinceSql(
  instantSql: SQL,
  clock: StateSqlClock,
): SQL {
  return sql`CAST((
    julianday(${clock.businessTodayYmdRaw})
    - julianday(date(datetime(${instantSql}, ${clock.tzModifier})))
  ) ${AS_INTEGER})`;
}

/** Inclusive lookback window for churn Family B (day 0..windowDays). */
export function buildStateCalendarDaysUntilNowSql(
  instantSql: SQL,
  clock: StateSqlClock,
): SQL {
  return sql`CAST((
    julianday(date(datetime(${instantSql}, ${clock.tzModifier})))
    - julianday(${clock.businessTodayYmdRaw})
  ) ${AS_INTEGER})`;
}

function buildStageAliasCases(): SQL {
  return sql`CASE trim(${c.salesStage})
    WHEN 'negotiating' THEN 'negotiation'
    WHEN 'converted' THEN 'closed_won'
    WHEN 'lost' THEN 'closed_lost'
    ELSE trim(${c.salesStage})
  END`;
}

/** Canonical stage string or `'unknown'`. Mirrors `normalizeSalesStage`. */
export function buildNormalizedStageSql(): SQL {
  const aliased = buildStageAliasCases();
  return sql`CASE
    WHEN trim(${c.salesStage}) = '' THEN 'unknown'
    WHEN ${aliased} IN (
      'new_lead', 'contacted', 'interested', 'proposal', 'negotiation',
      'on_hold', 'closed_won', 'paid', 'closed_lost'
    ) THEN ${aliased}
    ELSE 'unknown'
  END`;
}

export function buildStateScopeFlagsSql(): SQL {
  const stage = buildNormalizedStageSql();
  return sql`json_object(
    'stage', ${stage},
    'is_post_sale', CASE WHEN ${stage} IN ('closed_won', 'paid') THEN 1 ELSE 0 END,
    'is_closed_lost', CASE WHEN ${stage} = 'closed_lost' THEN 1 ELSE 0 END,
    'is_stage_unknown', CASE WHEN ${stage} = 'unknown' THEN 1 ELSE 0 END,
    'is_unowned', CASE WHEN ${c.ownerId} IS NULL OR ${c.status} = 'public_pool' THEN 1 ELSE 0 END,
    'is_deferred', CASE WHEN ${stage} = 'on_hold' THEN 1 ELSE 0 END
  )`;
}

export function buildParsedLastValidSql(): SQL {
  return buildStateInstantSql(c.lastValidFollowUpAt);
}

export function buildParsedNextFollowUpSql(): SQL {
  return buildStateInstantSql(c.nextFollowUpAt);
}

export function buildDaysSinceValidInteractionSql(clock: StateSqlClock): SQL {
  const parsed = buildParsedLastValidSql();
  return sql`CASE
    WHEN ${parsed} IS NULL THEN NULL
    ELSE ${buildStateCalendarDaysSinceSql(parsed, clock)}
  END`;
}

/** HK calendar idle days — reuses frozen reclamation primitive semantics. */
export function buildReclamationIdleDaysSql(clock: StateSqlClock): SQL {
  const hkToday = getBusinessDateYmd(clock.now, HONG_KONG_TIMEZONE);
  const cycleAnchor = sql`COALESCE(${c.reclamationCycleStartedAt}, ${c.lastValidFollowUpAt}, ${c.createdAt})`;
  return sql`COALESCE(
    CAST((julianday(${sql.raw(`'${hkToday.replace(/'/g, "''")}'`)}) - julianday(date(datetime(${cycleAnchor}, '+8 hours')))) ${AS_INTEGER}),
    0
  )`;
}

export function buildHasCollaboratorSql(): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${ca}
    WHERE ${ca.customerId} = ${c.id}
      AND ${ca.role} = 'collaborator'
  )`;
}

export function buildReclamationExemptSql(clock: StateSqlClock): SQL {
  return sql`CASE
    WHEN ${c.salesStage} IN ('closed_won', 'converted', 'on_hold', 'paid') OR ${c.isPinned} = 1 THEN 1
    WHEN ${buildHasCollaboratorSql()} THEN 1
    WHEN ${c.ownerId} IS NULL OR ${c.status} = 'public_pool' THEN 1
    WHEN ${c.status} != 'active' THEN 1
    WHEN ${c.reclaimRuleGraceUntil} IS NOT NULL
      AND ${c.reclaimRuleGraceUntil} > ${clock.nowIsoRaw} THEN 1
    ELSE 0
  END`;
}

/** Follow-up strictly after supersession anchor (valid instants only). */
export function buildFollowUpAfterSupersessionSql(
  followUpTimeColumn: SQL,
  supersessionInstant: SQL,
): SQL {
  return sql`(
    ${followUpTimeColumn} IS NOT NULL
    AND julianday(${followUpTimeColumn}) > julianday(COALESCE(${supersessionInstant}, '0000-01-01'))
  )`;
}

/** Compact follow-up instant guard for churn aggregation subqueries. */
function buildChurnFollowUpInstantSql(column: AnyColumn | SQL): SQL {
  const trimmed = buildStateTrimmedSql(column);
  const datePart = sql`substr(${trimmed}, 1, 10)`;
  return sql`CASE
    WHEN ${column} IS NULL OR ${trimmed} = '' OR length(${trimmed}) < 10 THEN NULL
    WHEN CAST(strftime('%m', date(${datePart})) AS INTEGER) != CAST(substr(${trimmed}, 6, 2) AS INTEGER) THEN NULL
    WHEN CAST(strftime('%d', date(${datePart})) AS INTEGER) != CAST(substr(${trimmed}, 9, 2) AS INTEGER) THEN NULL
    ELSE ${trimmed}
  END`;
}

export function buildChurnOutcomeCountSql(
  supersessionInstant: SQL,
  clock: StateSqlClock,
  windowDays: number,
  outcomeLiteral: string,
  customerIdColumn: SQL = sql`${c.id}`,
): SQL {
  const parsedFollowUp = buildChurnFollowUpInstantSql(fu.followUpTime);
  const daysUntilNow = buildStateCalendarDaysUntilNowSql(parsedFollowUp, clock);
  return sql`COALESCE((
    SELECT COUNT(*)
    FROM ${fu}
    WHERE ${fu.customerId} = ${customerIdColumn}
      AND ${fu.outcome} IN (${sql.raw(outcomeLiteral)})
      AND ${parsedFollowUp} IS NOT NULL
      AND ${buildFollowUpAfterSupersessionSql(parsedFollowUp, supersessionInstant)}
      AND (${daysUntilNow} <= 0 AND (${daysUntilNow} * -1) <= ${sql.raw(String(windowDays))})
  ), 0)`;
}

export function buildChurnFamilyCSql(
  supersessionInstant: SQL,
  customerIdColumn: SQL = sql`${c.id}`,
): SQL {
  const parsedFollowUp = buildChurnFollowUpInstantSql(fu.followUpTime);
  return sql`CASE WHEN EXISTS (
    SELECT 1 FROM ${fu}
    WHERE ${fu.customerId} = ${customerIdColumn}
      AND ${fu.outcome} IN ('lost_contact', 'not_interested')
      AND ${parsedFollowUp} IS NOT NULL
      AND ${buildFollowUpAfterSupersessionSql(parsedFollowUp, supersessionInstant)}
  ) THEN 1 ELSE 0 END`;
}

export function buildSharedStateSqlFragments(
  clock: StateSqlClock,
  churnWindowDays = 60,
): {
  stage: SQL;
  parsedLastValid: SQL;
  parsedNextFollowUp: SQL;
  daysSinceValid: SQL;
  reclamationIdleDays: SQL;
  reclamationExempt: SQL;
  noReplyCount: SQL;
  noContactCount: SQL;
  familyC: SQL;
} {
  const stage = buildNormalizedStageSql();
  const parsedLastValid = buildParsedLastValidSql();
  const parsedNextFollowUp = buildParsedNextFollowUpSql();
  return {
    stage,
    parsedLastValid,
    parsedNextFollowUp,
    daysSinceValid: sql`CASE
      WHEN ${parsedLastValid} IS NULL THEN NULL
      ELSE ${buildStateCalendarDaysSinceSql(parsedLastValid, clock)}
    END`,
    reclamationIdleDays: buildReclamationIdleDaysSql(clock),
    reclamationExempt: buildReclamationExemptSql(clock),
    noReplyCount: buildChurnOutcomeCountSql(
      parsedLastValid,
      clock,
      churnWindowDays,
      "'no_reply'",
    ),
    noContactCount: buildChurnOutcomeCountSql(
      parsedLastValid,
      clock,
      churnWindowDays,
      "'no_contact'",
    ),
    familyC: buildChurnFamilyCSql(parsedLastValid),
  };
}

export function buildActiveSlaStageFromStageSql(stage: SQL): SQL {
  return sql`${stage} IN (
    'new_lead', 'contacted', 'interested', 'proposal', 'negotiation'
  )`;
}

export function buildChurnEligibleStageFromStageSql(stage: SQL): SQL {
  return sql`${stage} IN ('contacted', 'interested', 'proposal', 'negotiation')`;
}

export function buildHighIntentStageFromStageSql(stage: SQL): SQL {
  return sql`${stage} IN ('interested', 'proposal', 'negotiation')`;
}

export function buildActiveSlaStageSql(): SQL {
  return buildActiveSlaStageFromStageSql(buildNormalizedStageSql());
}

export function buildChurnEligibleStageSql(): SQL {
  return buildChurnEligibleStageFromStageSql(buildNormalizedStageSql());
}

export function buildHighIntentStageSql(): SQL {
  return buildHighIntentStageFromStageSql(buildNormalizedStageSql());
}
