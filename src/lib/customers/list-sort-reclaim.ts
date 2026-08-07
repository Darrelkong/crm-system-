import { asc, sql, type SQL } from "drizzle-orm";
import type { Customer } from "../../../drizzle/schema/customers";
import { schema } from "@/lib/db";
import { compareCustomersForList } from "@/lib/customers/list-sort";
import { buildCustomerListOrderBy } from "@/lib/customers/list-sort";
import { isPublicPoolCustomer } from "@/lib/permissions/customers";
import { getBusinessDateYmd } from "@/lib/reports/dates";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";
import {
  isReclamationEligibleCustomer,
  RECLAMATION_EXCLUDED_SALES_STAGES,
} from "@/lib/reclamation/constants";
import { isReclaimGraceActive } from "@/lib/reclamation/cycle";
import { getDaysWithoutValidFollowUp } from "@/lib/reclamation/days";
import type { CustomerListSortMode } from "@/lib/customers/customer-list-sort";

export type ReclaimSortKey = {
  group: number;
  graceUntil: string | null;
  daysRemaining: number;
};

function isReclaimSortEligibleCustomer(
  customer: Pick<Customer, "status" | "ownerId" | "salesStage" | "isPinned">,
  options?: { isCollaborative?: boolean },
): boolean {
  if (options?.isCollaborative) {
    return false;
  }
  if (isPublicPoolCustomer(customer as Customer)) {
    return false;
  }
  if (customer.status !== "active" || !customer.ownerId) {
    return false;
  }
  return isReclamationEligibleCustomer(customer);
}

type ReclaimSortableCustomer = Pick<
  Customer,
  | "id"
  | "status"
  | "ownerId"
  | "salesStage"
  | "isPinned"
  | "pinnedAt"
  | "reclaimRuleGraceUntil"
  | "reclamationCycleStartedAt"
  | "lastValidFollowUpAt"
  | "createdAt"
  | "nextFollowUpAt"
>;

export function getReclaimSortKey(
  customer: ReclaimSortableCustomer,
  reclaimDays: number,
  now: Date = new Date(),
  options?: { isCollaborative?: boolean },
): ReclaimSortKey {
  if (!isReclaimSortEligibleCustomer(customer, options)) {
    return { group: 3, graceUntil: null, daysRemaining: 99_999 };
  }

  const idleDays = getDaysWithoutValidFollowUp(customer as Customer, now);
  if (idleDays >= reclaimDays) {
    if (isReclaimGraceActive(customer, now) && customer.reclaimRuleGraceUntil) {
      return {
        group: 1,
        graceUntil: customer.reclaimRuleGraceUntil,
        daysRemaining: 0,
      };
    }
    return { group: 0, graceUntil: null, daysRemaining: 0 };
  }

  return {
    group: 2,
    graceUntil: null,
    daysRemaining: reclaimDays - idleDays,
  };
}

export function compareCustomersForReclaimSoonest(
  a: ReclaimSortableCustomer,
  b: ReclaimSortableCustomer,
  reclaimDays: number,
  now: Date = new Date(),
  collaborativeFlags?: Map<string, boolean>,
): number {
  const keyA = getReclaimSortKey(a, reclaimDays, now, {
    isCollaborative: collaborativeFlags?.get(a.id) ?? false,
  });
  const keyB = getReclaimSortKey(b, reclaimDays, now, {
    isCollaborative: collaborativeFlags?.get(b.id) ?? false,
  });

  if (keyA.group !== keyB.group) {
    return keyA.group - keyB.group;
  }

  if (keyA.group === 1) {
    const graceCmp = (keyA.graceUntil ?? "").localeCompare(
      keyB.graceUntil ?? "",
    );
    if (graceCmp !== 0) {
      return graceCmp;
    }
  }

  if (keyA.group === 2 && keyA.daysRemaining !== keyB.daysRemaining) {
    return keyA.daysRemaining - keyB.daysRemaining;
  }

  return compareCustomersForList(a as Customer, b as Customer, now);
}

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

  return [
    asc(sortGroup),
    asc(c.reclaimRuleGraceUntil),
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

export function sortCustomersForReclaimSoonest<T extends ReclaimSortableCustomer>(
  customers: T[],
  reclaimDays: number,
  now: Date = new Date(),
  collaborativeFlags?: Map<string, boolean>,
): T[] {
  return [...customers].sort((a, b) =>
    compareCustomersForReclaimSoonest(
      a,
      b,
      reclaimDays,
      now,
      collaborativeFlags,
    ),
  );
}
