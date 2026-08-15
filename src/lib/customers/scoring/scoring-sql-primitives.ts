import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import { schema } from "@/lib/db";
import { getBusinessDateYmd } from "@/lib/reports/dates";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";
import type { EffectiveSettings } from "@/lib/settings/effective";
import { HIGH_ENGAGEMENT_STAGES } from "./constants";
import type { HeatLevel } from "./types";

const c = schema.customers;
const AS_INTEGER = sql.raw("AS INTEGER");

/**
 * Matches JS `hasText()` used by calculateDataCompletenessScore.
 *
 * Production writes trim customer text fields on save (see validation.ts).
 * SQLite `trim()` removes ASCII space (0x20) only; full-width / Unicode
 * whitespace is rejected or normalized before persistence.
 */
export function sqlFieldHasText(column: AnyColumn | SQL): SQL {
  return sql`(
    ${column} IS NOT NULL
    AND length(
      trim(
        replace(
          replace(
            replace(${column}, char(9), ''),
            char(10), ''),
          char(13), '')
      )
    ) > 0
  )`;
}

/** Matches calculateCustomerHeat `daysSince()`: Math.floor(ms / MS_PER_DAY). */
export function buildUtcDaysSinceSql(
  isoColumn: AnyColumn | SQL,
  nowIso: string,
): SQL {
  return sql`CAST(floor((julianday(${nowIso}) - julianday(${isoColumn}))) ${AS_INTEGER})`;
}

/** HK business-calendar idle days aligned with getDaysWithoutValidFollowUp(). */
export function buildDaysWithoutValidSql(now: Date = new Date()): SQL {
  const hkToday = getBusinessDateYmd(now, HONG_KONG_TIMEZONE);
  const cycleAnchor = sql`COALESCE(${c.reclamationCycleStartedAt}, ${c.lastValidFollowUpAt}, ${c.createdAt})`;
  return sql`CAST((julianday(${hkToday}) - julianday(date(datetime(${cycleAnchor}, '+8 hours')))) ${AS_INTEGER})`;
}

/** SQL expression replicating calculateDataCompletenessScore point sum. */
export function buildCompletenessScoreSql(): SQL {
  const fu = schema.followUps;
  return sql`(
    (CASE WHEN ${sqlFieldHasText(c.customerName)} THEN 10 ELSE 0 END)
    + (CASE WHEN ${sqlFieldHasText(c.phone)} OR ${sqlFieldHasText(c.wechatId)} THEN 20 ELSE 0 END)
    + (CASE WHEN ${sqlFieldHasText(c.email)} THEN 10 ELSE 0 END)
    + (CASE WHEN ${sqlFieldHasText(c.source)} THEN 10 ELSE 0 END)
    + (CASE WHEN ${sqlFieldHasText(c.salesStage)} THEN 10 ELSE 0 END)
    + (CASE WHEN ${sqlFieldHasText(c.ownerId)} THEN 10 ELSE 0 END)
    + (CASE WHEN ${sqlFieldHasText(c.notes)} THEN 10 ELSE 0 END)
    + (CASE WHEN EXISTS (
        SELECT 1 FROM ${fu}
        WHERE ${fu.customerId} = ${c.id}
      ) THEN 10 ELSE 0 END)
    + (CASE WHEN ${sqlFieldHasText(c.nextFollowUpAt)} THEN 10 ELSE 0 END)
  )`;
}

function buildHighEngagementStagesSql(): SQL {
  return sql.join(
    [...HIGH_ENGAGEMENT_STAGES].map((stage) => sql`${stage}`),
    sql`, `,
  );
}

/** De Morgan form of NOT high_churn_risk — avoids nested NOT on CAST fragments. */
function buildNotHighChurnRiskSql(
  settings: EffectiveSettings,
  now: Date = new Date(),
): SQL {
  const nowIso = now.toISOString();
  const idleDays = buildDaysWithoutValidSql(now);
  const warningThreshold = settings.reclaimWarningThresholdDays;
  const nearReclaimThreshold = Math.max(1, settings.automaticReclaimDays - 1);

  return sql`(
    ${idleDays} < ${warningThreshold}
    AND (${c.nextFollowUpAt} IS NULL OR ${c.nextFollowUpAt} >= ${nowIso})
    AND ${idleDays} < ${nearReclaimThreshold}
  )`;
}

function buildNotHighTierSql(
  settings: EffectiveSettings,
  now: Date = new Date(),
): SQL {
  const nowIso = now.toISOString();
  const daysSinceLastValid = buildUtcDaysSinceSql(c.lastValidFollowUpAt, nowIso);
  const highEngagement = buildHighEngagementStagesSql();

  return sql`(
    (${c.lastValidFollowUpAt} IS NULL OR ${daysSinceLastValid} > 7)
    AND ${c.salesStage} NOT IN (${highEngagement})
    AND NOT (
      ${c.nextFollowUpAt} IS NOT NULL
      AND ${c.nextFollowUpAt} >= ${nowIso}
      AND ${c.lastValidFollowUpAt} IS NOT NULL
    )
  )`;
}

function buildNotMediumTierSql(
  settings: EffectiveSettings,
  now: Date = new Date(),
): SQL {
  const nowIso = now.toISOString();
  const daysSinceLastValid = buildUtcDaysSinceSql(c.lastValidFollowUpAt, nowIso);

  return sql`(
    (${c.lastValidFollowUpAt} IS NULL OR ${daysSinceLastValid} > 14)
    AND (${c.nextFollowUpAt} IS NULL OR ${c.nextFollowUpAt} < ${nowIso})
  )`;
}

function buildNotSilentTierSql(
  settings: EffectiveSettings,
  now: Date = new Date(),
): SQL {
  const nowIso = now.toISOString();
  const daysSinceLastValid = buildUtcDaysSinceSql(c.lastValidFollowUpAt, nowIso);

  return sql`(
    ${c.lastValidFollowUpAt} IS NOT NULL
    AND (${daysSinceLastValid} <= 14)
  )`;
}

/** high_churn_risk branch of calculateCustomerHeat. */
export function buildHighChurnRiskSql(
  settings: EffectiveSettings,
  now: Date = new Date(),
): SQL {
  const nowIso = now.toISOString();
  const idleDays = buildDaysWithoutValidSql(now);
  const warningThreshold = settings.reclaimWarningThresholdDays;
  const nearReclaimThreshold = Math.max(1, settings.automaticReclaimDays - 1);

  return sql`(
    ${idleDays} >= ${warningThreshold}
    OR (${c.nextFollowUpAt} IS NOT NULL AND ${c.nextFollowUpAt} < ${nowIso})
    OR ${idleDays} >= ${nearReclaimThreshold}
  )`;
}

function buildHighTierSql(
  settings: EffectiveSettings,
  now: Date = new Date(),
): SQL {
  const nowIso = now.toISOString();
  const daysSinceLastValid = buildUtcDaysSinceSql(c.lastValidFollowUpAt, nowIso);
  const highEngagement = buildHighEngagementStagesSql();

  return sql`(
    (${c.lastValidFollowUpAt} IS NOT NULL AND ${daysSinceLastValid} <= 7)
    OR ${c.salesStage} IN (${highEngagement})
    OR (
      ${c.nextFollowUpAt} IS NOT NULL
      AND ${c.nextFollowUpAt} >= ${nowIso}
      AND ${c.lastValidFollowUpAt} IS NOT NULL
    )
  )`;
}

function buildMediumTierSql(
  settings: EffectiveSettings,
  now: Date = new Date(),
): SQL {
  const nowIso = now.toISOString();
  const daysSinceLastValid = buildUtcDaysSinceSql(c.lastValidFollowUpAt, nowIso);

  return sql`(
    (${c.lastValidFollowUpAt} IS NOT NULL AND ${daysSinceLastValid} <= 14)
    OR (
      ${c.nextFollowUpAt} IS NOT NULL
      AND ${c.nextFollowUpAt} >= ${nowIso}
    )
  )`;
}

function buildSilentTierSql(
  settings: EffectiveSettings,
  now: Date = new Date(),
): SQL {
  const nowIso = now.toISOString();
  const daysSinceLastValid = buildUtcDaysSinceSql(c.lastValidFollowUpAt, nowIso);

  return sql`(
    ${c.lastValidFollowUpAt} IS NULL
    OR ${daysSinceLastValid} > 14
  )`;
}

/**
 * Exact heat-level filter predicate following calculateCustomerHeat priority.
 * Not wired to production list routes in PRE phase.
 */
export function buildHeatLevelFilterSql(
  heat: HeatLevel,
  settings: EffectiveSettings,
  now: Date = new Date(),
): SQL {
  const notChurn = buildNotHighChurnRiskSql(settings, now);
  const high = buildHighTierSql(settings, now);
  const notHigh = buildNotHighTierSql(settings, now);
  const medium = buildMediumTierSql(settings, now);
  const notMedium = buildNotMediumTierSql(settings, now);
  const silent = buildSilentTierSql(settings, now);
  const notSilent = buildNotSilentTierSql(settings, now);

  switch (heat) {
    case "high_churn_risk":
      return buildHighChurnRiskSql(settings, now);
    case "high":
      return sql`(${notChurn} AND (${high}))`;
    case "medium":
      return sql`(${notChurn} AND ${notHigh} AND (${medium}))`;
    case "silent":
      return sql`(${notChurn} AND ${notHigh} AND ${notMedium} AND (${silent}))`;
    case "low":
      return sql`(${notChurn} AND ${notHigh} AND ${notMedium} AND ${notSilent})`;
  }
}

/** completenessScore < threshold (strict less-than). */
export function buildCompletenessBelowSql(threshold: number): SQL {
  return sql`${buildCompletenessScoreSql()} < ${threshold}`;
}
