import { asc, desc, sql, type SQL } from "drizzle-orm";
import { schema } from "@/lib/db";
import { getBusinessTodayRange } from "@/lib/reports/dates";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";
import { customerRatingRankSql, DEFAULT_RATING_WARNING_DAYS, warningOrderBy, warningSortKey } from "@/lib/customers/rating/sort";
import { customerRatingRank } from "@/lib/customers/rating/domain";
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

function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

/** In-memory comparator matching DB list order (for tests). */
export function compareCustomersForList(
  a: Customer,
  b: Customer,
  now: Date = new Date(),
  options: { automaticReclaimDays?: number; reclaimWarningDaysBefore?: number; collaborativeCustomerIds?: ReadonlySet<string>; maskUnownedRating?: boolean } = {},
): number {
  if (options.automaticReclaimDays != null && options.automaticReclaimDays >= 1) {
    const keys = [a, b].map(c => warningSortKey(c, options.automaticReclaimDays!, options.reclaimWarningDaysBefore ?? DEFAULT_RATING_WARNING_DAYS,
      now, options.collaborativeCustomerIds?.has(c.id)));
    const urgency = keys[0][0] - keys[1][0] || compareText(keys[0][1], keys[1][1]) || keys[0][2] - keys[1][2];
    if (urgency) return urgency;
  }
  const rank = (c: Customer) => customerRatingRank(options.maskUnownedRating && !c.ownerId ? null : c.customerRating ?? null);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  const pinA = a.isPinned === 1 ? 1 : 0;
  const pinB = b.isPinned === 1 ? 1 : 0;
  if (pinB !== pinA) {
    return pinB - pinA;
  }

  {
    const pinnedAtA = a.pinnedAt ?? "";
    const pinnedAtB = b.pinnedAt ?? "";
    if (pinnedAtA !== pinnedAtB) {
      return compareText(pinnedAtB, pinnedAtA);
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
    return compareText(nextA, nextB);
  }

  const lastValidA = a.lastValidFollowUpAt ?? "";
  const lastValidB = b.lastValidFollowUpAt ?? "";
  if (lastValidA !== lastValidB) {
    return compareText(lastValidA, lastValidB);
  }

  return compareText(a.createdAt, b.createdAt) || compareText(a.id, b.id);
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
 * Operational warning urgency → human rating → pin → existing follow-up keys.
 */
export function buildCustomerListOrderBy(
  now: Date = new Date(),
  automaticReclaimDays?: number,
  reclaimWarningDaysBefore = DEFAULT_RATING_WARNING_DAYS,
  maskUnownedRating = false,
) {
  const c = schema.customers;
  const order: SQL[] = [];

  if (
    automaticReclaimDays != null &&
    Number.isFinite(automaticReclaimDays) &&
    automaticReclaimDays >= 1
  ) {
    order.push(...warningOrderBy(automaticReclaimDays, reclaimWarningDaysBefore, now));
  }

  order.push(
    asc(customerRatingRankSql(maskUnownedRating)), desc(c.isPinned), desc(c.pinnedAt),
    buildFollowUpSortCase(now),
    asc(c.nextFollowUpAt),
    asc(c.lastValidFollowUpAt),
    asc(c.createdAt),
    asc(c.id),
  );

  return order;
}

/** @deprecated Use buildCustomerListOrderBy */
export function buildFollowUpSort(now: Date = new Date()) {
  return buildCustomerListOrderBy(now).slice(3);
}
