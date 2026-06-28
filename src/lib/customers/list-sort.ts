import { asc, desc, sql, type SQL } from "drizzle-orm";
import { schema } from "@/lib/db";
import { getBusinessTodayRange } from "@/lib/reports/dates";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";
import type { Customer } from "../../../drizzle/schema/customers";

const DEPRIORITIZED_SALES_STAGES = new Set([
  "closed_won",
  "closed_lost",
  "on_hold",
]);

const NEVER_FOLLOWED_UP_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/** Mirrors SQL bucket order in buildFollowUpSortCase (ASC — lower = earlier). */
export function getFollowUpSortBucket(
  customer: Pick<
    Customer,
    | "status"
    | "salesStage"
    | "isPinned"
    | "nextFollowUpAt"
    | "lastValidFollowUpAt"
    | "createdAt"
  >,
  now: Date = new Date(),
): number {
  const isPinned = customer.isPinned === 1;

  if (
    customer.status === "inactive" ||
    (DEPRIORITIZED_SALES_STAGES.has(customer.salesStage) && !isPinned)
  ) {
    return 6;
  }

  const nowIso = now.toISOString();
  const establishedBeforeIso = new Date(
    now.getTime() - NEVER_FOLLOWED_UP_AGE_MS,
  ).toISOString();
  const { start: todayStart, end: todayEnd } = getBusinessTodayRange(
    now,
    HONG_KONG_TIMEZONE,
  );

  if (customer.nextFollowUpAt && customer.nextFollowUpAt < nowIso) {
    return 0;
  }
  if (
    customer.nextFollowUpAt &&
    customer.nextFollowUpAt >= todayStart &&
    customer.nextFollowUpAt <= todayEnd
  ) {
    return 1;
  }
  if (
    customer.lastValidFollowUpAt &&
    customer.lastValidFollowUpAt <= establishedBeforeIso
  ) {
    return 2;
  }
  if (
    !customer.lastValidFollowUpAt &&
    customer.createdAt <= establishedBeforeIso
  ) {
    return 3;
  }
  if (
    !customer.lastValidFollowUpAt &&
    customer.createdAt > establishedBeforeIso
  ) {
    return 5;
  }
  return 4;
}

/** In-memory comparator matching DB list order (for tests). */
export function compareCustomersForList(
  a: Customer,
  b: Customer,
  now: Date = new Date(),
): number {
  const pinA = a.isPinned === 1 ? 1 : 0;
  const pinB = b.isPinned === 1 ? 1 : 0;
  if (pinB !== pinA) {
    return pinB - pinA;
  }

  if (pinA === 1) {
    const pinnedAtA = a.pinnedAt ?? "";
    const pinnedAtB = b.pinnedAt ?? "";
    if (pinnedAtA !== pinnedAtB) {
      return pinnedAtB.localeCompare(pinnedAtA);
    }
  }

  const bucketA = getFollowUpSortBucket(a, now);
  const bucketB = getFollowUpSortBucket(b, now);
  if (bucketA !== bucketB) {
    return bucketA - bucketB;
  }

  const nextA = a.nextFollowUpAt ?? "";
  const nextB = b.nextFollowUpAt ?? "";
  if (nextA !== nextB) {
    return nextA.localeCompare(nextB);
  }

  const lastValidA = a.lastValidFollowUpAt ?? "";
  const lastValidB = b.lastValidFollowUpAt ?? "";
  if (lastValidA !== lastValidB) {
    return lastValidA.localeCompare(lastValidB);
  }

  return a.createdAt.localeCompare(b.createdAt);
}

function buildFollowUpSortCase(now: Date = new Date()): SQL {
  const nowIso = now.toISOString();
  const establishedBeforeIso = new Date(
    now.getTime() - NEVER_FOLLOWED_UP_AGE_MS,
  ).toISOString();
  const { start: todayStart, end: todayEnd } = getBusinessTodayRange(
    now,
    HONG_KONG_TIMEZONE,
  );
  const c = schema.customers;
  const deprioritizedStages = sql`'closed_won', 'closed_lost', 'on_hold'`;

  return sql`CASE
      WHEN ${c.status} = 'inactive'
        OR (${c.salesStage} IN (${deprioritizedStages}) AND COALESCE(${c.isPinned}, 0) != 1)
      THEN 6
      WHEN ${c.nextFollowUpAt} IS NOT NULL AND ${c.nextFollowUpAt} < ${nowIso} THEN 0
      WHEN ${c.nextFollowUpAt} IS NOT NULL
        AND ${c.nextFollowUpAt} >= ${todayStart}
        AND ${c.nextFollowUpAt} <= ${todayEnd} THEN 1
      WHEN ${c.lastValidFollowUpAt} IS NOT NULL
        AND ${c.lastValidFollowUpAt} <= ${establishedBeforeIso} THEN 2
      WHEN ${c.lastValidFollowUpAt} IS NULL
        AND ${c.createdAt} <= ${establishedBeforeIso} THEN 3
      WHEN ${c.lastValidFollowUpAt} IS NULL
        AND ${c.createdAt} > ${establishedBeforeIso} THEN 5
      ELSE 4
    END`;
}

/**
 * Customer list order: pinned first → pinnedAt DESC → Phase C-1 follow-up buckets.
 */
export function buildCustomerListOrderBy(now: Date = new Date()) {
  const c = schema.customers;

  return [
    desc(c.isPinned),
    desc(c.pinnedAt),
    buildFollowUpSortCase(now),
    asc(c.nextFollowUpAt),
    asc(c.lastValidFollowUpAt),
    asc(c.createdAt),
  ];
}

/** @deprecated Use buildCustomerListOrderBy */
export function buildFollowUpSort(now: Date = new Date()) {
  return buildCustomerListOrderBy(now).slice(2);
}
