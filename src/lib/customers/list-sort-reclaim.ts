import { asc, sql, type SQL } from "drizzle-orm";
import { schema } from "@/lib/db";
import { buildCustomerListOrderBy } from "@/lib/customers/list-sort";
import { getBusinessDateYmd } from "@/lib/reports/dates";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";
import { RECLAMATION_EXCLUDED_SALES_STAGES } from "@/lib/reclamation/constants";
import type { CustomerListSortMode } from "@/lib/customers/customer-list-sort";

/** HK calendar-day idle count aligned with getDaysWithoutValidFollowUp(). */
export function buildReclamationIdleDaysSql(now: Date = new Date()): SQL {
  const c = schema.customers;
  const hkToday = getBusinessDateYmd(now, HONG_KONG_TIMEZONE);
  const cycleAnchor = sql`COALESCE(${c.reclamationCycleStartedAt}, ${c.lastValidFollowUpAt}, ${c.createdAt})`;
  return sql`CAST((julianday(${hkToday}) - julianday(date(datetime(${cycleAnchor}, '+8 hours')))) AS INTEGER)`;
}

function buildReclamationEligibleSql(): SQL {
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

/**
 * reclaim_soonest: due → grace → countdown ASC → ineligible,
 * with default list order as stable tie-break.
 */
export function buildCustomerListReclaimOrderBy(
  reclaimDays: number,
  now: Date = new Date(),
) {
  const c = schema.customers;
  const nowIso = now.toISOString();
  const idleDays = buildReclamationIdleDaysSql(now);
  const eligible = buildReclamationEligibleSql();
  const graceActive = sql`(
    ${c.reclaimRuleGraceUntil} IS NOT NULL
    AND ${c.reclaimRuleGraceUntil} > ${nowIso}
  )`;
  const isDue = sql`(${eligible} AND ${idleDays} >= ${reclaimDays} AND NOT ${graceActive})`;
  const isGrace = sql`(${eligible} AND ${idleDays} >= ${reclaimDays} AND ${graceActive})`;

  const sortGroup = sql`CASE
    WHEN ${isDue} THEN 0
    WHEN ${isGrace} THEN 1
    WHEN ${eligible} AND ${idleDays} < ${reclaimDays} THEN 2
    ELSE 3
  END`;

  const countdownRemaining = sql`CASE
    WHEN ${eligible} AND ${idleDays} < ${reclaimDays}
      THEN (${reclaimDays} - ${idleDays})
    ELSE 99999
  END`;

  const graceSortKey = sql`CASE
    WHEN ${isGrace} THEN ${c.reclaimRuleGraceUntil}
    ELSE NULL
  END`;

  return [
    asc(sortGroup),
    asc(graceSortKey),
    asc(countdownRemaining),
    ...buildCustomerListOrderBy(now),
  ];
}

export function buildCustomerListOrderByForMode(
  sortMode: CustomerListSortMode,
  reclaimDays: number,
  now: Date = new Date(),
) {
  if (sortMode === "reclaim_soonest") {
    return buildCustomerListReclaimOrderBy(reclaimDays, now);
  }
  return buildCustomerListOrderBy(now);
}
