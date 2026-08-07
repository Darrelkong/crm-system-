import { asc, sql } from "drizzle-orm";
import { schema } from "@/lib/db";
import { buildCustomerListOrderBy } from "@/lib/customers/list-sort";
import {
  buildReclamationEligibleSql,
  buildReclamationGraceActiveSql,
  buildReclamationIdleDaysSql,
} from "@/lib/customers/list-sort-reclaim-primitives";
import type { CustomerListSortMode } from "@/lib/customers/customer-list-sort";

export {
  NEAR_RELEASE_RISK_DAYS,
  buildNearReleaseRiskOrderClauses,
  buildReclamationEligibleSql,
  buildReclamationGraceActiveSql,
  buildReclamationIdleDaysSql,
} from "@/lib/customers/list-sort-reclaim-primitives";

/**
 * reclaim_soonest: due → grace → countdown ASC → ineligible,
 * with default list order as stable tie-break.
 */
export function buildCustomerListReclaimOrderBy(
  reclaimDays: number,
  now: Date = new Date(),
) {
  const c = schema.customers;
  const idleDays = buildReclamationIdleDaysSql(now);
  const eligible = buildReclamationEligibleSql();
  const graceActive = buildReclamationGraceActiveSql(now);
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
  return buildCustomerListOrderBy(now, reclaimDays);
}
