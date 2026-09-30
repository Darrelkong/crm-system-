import { asc, sql } from "drizzle-orm";
import { schema } from "@/lib/db";
import { SETTING_DEFAULTS } from "@/lib/settings/keys";
import { isReclamationEligibleCustomer } from "@/lib/reclamation/constants";
import { getDaysWithoutValidFollowUp } from "@/lib/reclamation/days";
import { isReclaimGraceActive } from "@/lib/reclamation/cycle";
import { buildReclamationEligibleSql, buildReclamationGraceActiveSql, buildReclamationIdleDaysSql } from "../list-sort-reclaim-primitives";
import type { Customer } from "../../../../drizzle/schema/customers";
export const DEFAULT_RATING_WARNING_DAYS = Number(SETTING_DEFAULTS.reclaim_warning_days_before);
export function customerRatingRankSql(maskUnowned = false) {
  const c = schema.customers;
  const value = maskUnowned ? sql`CASE WHEN ${c.ownerId} IS NOT NULL THEN ${c.customerRating} ELSE NULL END` : c.customerRating;
  return sql`CASE ${value} WHEN 'S' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'D' THEN 3 ELSE 4 END`;
}
export function adminPoolRatingOrderBy() {
  return [asc(customerRatingRankSql()), asc(schema.customers.poolEnteredAt), asc(schema.customers.id)];
}
export function warningOrderBy(reclaimDays: number, warningDays: number, now: Date) {
  const eligible = buildReclamationEligibleSql(), idle = buildReclamationIdleDaysSql(now), grace = buildReclamationGraceActiveSql(now);
  const due = sql`(${eligible} AND ${idle} >= ${reclaimDays})`;
  const upcoming = sql`(${eligible} AND ${idle} < ${reclaimDays} AND (${reclaimDays} - ${idle}) <= ${warningDays})`;
  return [asc(sql`CASE WHEN ${due} AND NOT ${grace} THEN 0 WHEN ${due} AND ${grace} THEN 1 WHEN ${upcoming} THEN 2 ELSE 3 END`),
    asc(sql`CASE WHEN ${due} AND ${grace} THEN ${schema.customers.reclaimRuleGraceUntil} ELSE NULL END`),
    asc(sql`CASE WHEN ${upcoming} THEN ${reclaimDays} - ${idle} ELSE 0 END`)];
}
/** Matches warningOrderBy; collaborators come from the same customer_assignees relation. */
export function warningSortKey(c: Customer, reclaimDays: number, warningDays: number, now: Date, isCollaborative = false): [number, string, number] {
  if (isCollaborative || c.status !== "active" || !c.ownerId || !isReclamationEligibleCustomer(c)) return [3, "", 0];
  const idle = getDaysWithoutValidFollowUp(c, now);
  if (idle >= reclaimDays) return isReclaimGraceActive(c, now) ? [1, c.reclaimRuleGraceUntil!, 0] : [0, "", 0];
  const remaining = reclaimDays - idle;
  return remaining <= warningDays ? [2, "", remaining] : [3, "", 0];
}
