import { asc, sql, type SQL } from "drizzle-orm";
import { schema } from "@/lib/db";
import { getBusinessDateYmd } from "@/lib/reports/dates";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";
import { RECLAMATION_EXCLUDED_SALES_STAGES } from "@/lib/reclamation/constants";

/** Hidden default-list priority window: eligible customers within this many days. */
export const NEAR_RELEASE_RISK_DAYS = 16;

/** HK calendar-day idle count aligned with getDaysWithoutValidFollowUp(). */
export function buildReclamationIdleDaysSql(now: Date = new Date()): SQL {
  const c = schema.customers;
  const hkToday = getBusinessDateYmd(now, HONG_KONG_TIMEZONE);
  const cycleAnchor = sql`COALESCE(${c.reclamationCycleStartedAt}, ${c.lastValidFollowUpAt}, ${c.createdAt})`;
  return sql`CAST((julianday(${hkToday}) - julianday(date(datetime(${cycleAnchor}, '+8 hours')))) AS INTEGER)`;
}

export function buildReclamationEligibleSql(): SQL {
  const c = schema.customers;
  const ca = schema.customerAssignees;
  const excludedStages = sql.join(
    RECLAMATION_EXCLUDED_SALES_STAGES.map((stage) => sql`${stage}`),
    sql`, `,
  );

  return sql`(
    ${c.status} = 'active'
    AND ${c.ownerId} IS NOT NULL
    AND ${c.status} != 'public_pool'
    AND COALESCE(${c.isPinned}, 0) = 0
    AND ${c.salesStage} NOT IN (${excludedStages})
    AND NOT EXISTS (
      SELECT 1 FROM ${ca}
      WHERE ${ca.customerId} = ${c.id}
        AND ${ca.role} = 'collaborator'
    )
  )`;
}

export function buildReclamationGraceActiveSql(now: Date = new Date()): SQL {
  const c = schema.customers;
  const nowIso = now.toISOString();
  return sql`(
    ${c.reclaimRuleGraceUntil} IS NOT NULL
    AND ${c.reclaimRuleGraceUntil} > ${nowIso}
  )`;
}

/** ORDER BY clauses for hidden <=16-day auto-release risk priority (after pin sort). */
export function buildNearReleaseRiskOrderClauses(
  reclaimDays: number,
  now: Date = new Date(),
): SQL[] {
  const c = schema.customers;
  const idleDays = buildReclamationIdleDaysSql(now);
  const eligible = buildReclamationEligibleSql();
  const graceActive = buildReclamationGraceActiveSql(now);
  const isDue = sql`(${eligible} AND ${idleDays} >= ${reclaimDays} AND NOT ${graceActive})`;
  const isGrace = sql`(${eligible} AND ${idleDays} >= ${reclaimDays} AND ${graceActive})`;
  const isInRiskWindow = sql`(
    ${eligible} AND (
      ${idleDays} >= ${reclaimDays}
      OR (
        ${idleDays} < ${reclaimDays}
        AND (${reclaimDays} - ${idleDays}) <= ${NEAR_RELEASE_RISK_DAYS}
      )
    )
  )`;

  const riskBucket = sql`CASE WHEN ${isInRiskWindow} THEN 0 ELSE 1 END`;
  const riskSortGroup = sql`CASE
    WHEN ${isDue} THEN 0
    WHEN ${isGrace} THEN 1
    WHEN ${eligible}
      AND ${idleDays} < ${reclaimDays}
      AND (${reclaimDays} - ${idleDays}) <= ${NEAR_RELEASE_RISK_DAYS}
      THEN 1 + (${reclaimDays} - ${idleDays})
    ELSE 99999
  END`;
  const graceSortKey = sql`CASE
    WHEN ${isGrace} THEN ${c.reclaimRuleGraceUntil}
    ELSE NULL
  END`;

  return [asc(riskBucket), asc(riskSortGroup), asc(graceSortKey)];
}
