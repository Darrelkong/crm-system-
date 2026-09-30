import { sql, type SQL } from "drizzle-orm";
import { schema } from "@/lib/db";
import { getBusinessDateYmd } from "@/lib/reports/dates";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";
import { RECLAMATION_EXCLUDED_SALES_STAGES } from "@/lib/reclamation/constants";

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
