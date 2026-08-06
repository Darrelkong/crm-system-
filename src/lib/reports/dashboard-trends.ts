import { and, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { RECLAMATION_AUDIT_ACTIONS } from "@/lib/reclamation/constants";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";
import type { User } from "../../../drizzle/schema/users";
import {
  fillDailySeries,
  getHongKongSeriesUtcBounds,
  TREND_SERIES_LOOKBACK_DAYS,
  type DailyPoint,
} from "./dashboard-trends-period";
import {
  ADMIN_TREND_METRICS,
  STAFF_TREND_METRICS,
  UNAVAILABLE_TREND_METRICS,
  type DashboardTrendsPayload,
} from "./dashboard-trends-types";

/** SQLite expression: UTC ISO timestamp → Asia/Hong_Kong calendar date YYYY-MM-DD. */
export const HK_DATE_SQL = (columnSql: ReturnType<typeof sql>) =>
  sql<string>`strftime('%Y-%m-%d', datetime(${columnSql}, '+8 hours'))`;

async function loadDailyCounts(
  rows: Promise<Array<{ day: string; value: number }>>,
  dates: string[],
): Promise<DailyPoint[]> {
  const list = await rows;
  const map = new Map<string, number>();
  for (const row of list) {
    map.set(row.day, Number(row.value ?? 0));
  }
  return fillDailySeries(dates, map);
}

async function countValidFollowUpsByDay(
  db: Database,
  startIso: string,
  endExclusiveIso: string,
  staffUserId?: string,
): Promise<Array<{ day: string; value: number }>> {
  const dayExpr = HK_DATE_SQL(sql`${schema.followUps.followUpTime}`);
  const conditions = [
    eq(schema.followUps.isValidFollowUp, 1),
    gte(schema.followUps.followUpTime, startIso),
    lt(schema.followUps.followUpTime, endExclusiveIso),
  ];
  if (staffUserId) {
    conditions.push(eq(schema.followUps.userId, staffUserId));
  }
  return db
    .select({
      day: dayExpr.mapWith(String),
      value: sql<number>`count(*)`.mapWith(Number),
    })
    .from(schema.followUps)
    .where(and(...conditions))
    .groupBy(dayExpr);
}

async function countNewCustomersByDay(
  db: Database,
  startIso: string,
  endExclusiveIso: string,
  createdBy?: string,
): Promise<Array<{ day: string; value: number }>> {
  const dayExpr = HK_DATE_SQL(sql`${schema.customers.createdAt}`);
  const conditions = [
    isNull(schema.customers.deletedAt),
    ne(schema.customers.status, "archived"),
    gte(schema.customers.createdAt, startIso),
    lt(schema.customers.createdAt, endExclusiveIso),
  ];
  if (createdBy) {
    conditions.push(eq(schema.customers.createdBy, createdBy));
  }
  return db
    .select({
      day: dayExpr.mapWith(String),
      value: sql<number>`count(*)`.mapWith(Number),
    })
    .from(schema.customers)
    .where(and(...conditions))
    .groupBy(dayExpr);
}

async function countAuditEventsByDay(
  db: Database,
  startIso: string,
  endExclusiveIso: string,
  actions: string[],
  options?: {
    actorUserId?: string;
    /** Filter auto/manual releases attributed to this previous owner via metadata. */
    previousOwnerId?: string;
    distinctEntity?: boolean;
  },
): Promise<Array<{ day: string; value: number }>> {
  const dayExpr = HK_DATE_SQL(sql`${schema.auditLogs.createdAt}`);
  const conditions = [
    inArray(schema.auditLogs.action, actions),
    gte(schema.auditLogs.createdAt, startIso),
    lt(schema.auditLogs.createdAt, endExclusiveIso),
  ];
  if (options?.actorUserId) {
    conditions.push(eq(schema.auditLogs.userId, options.actorUserId));
  }
  if (options?.previousOwnerId) {
    conditions.push(
      sql`json_extract(${schema.auditLogs.metadata}, '$.previousOwnerId') = ${options.previousOwnerId}`,
    );
  }
  const valueExpr = options?.distinctEntity
    ? sql<number>`count(distinct ${schema.auditLogs.entityId})`.mapWith(Number)
    : sql<number>`count(*)`.mapWith(Number);

  return db
    .select({
      day: dayExpr.mapWith(String),
      value: valueExpr,
    })
    .from(schema.auditLogs)
    .where(and(...conditions))
    .groupBy(dayExpr);
}

async function countStageEntriesByDay(
  db: Database,
  startIso: string,
  endExclusiveIso: string,
  newValue: string,
): Promise<Array<{ day: string; value: number }>> {
  const dayExpr = HK_DATE_SQL(sql`${schema.fieldChangeLogs.changedAt}`);
  return db
    .select({
      day: dayExpr.mapWith(String),
      value: sql<number>`count(distinct ${schema.fieldChangeLogs.customerId})`.mapWith(
        Number,
      ),
    })
    .from(schema.fieldChangeLogs)
    .where(
      and(
        eq(schema.fieldChangeLogs.fieldName, "sales_stage"),
        eq(schema.fieldChangeLogs.newValue, newValue),
        gte(schema.fieldChangeLogs.changedAt, startIso),
        lt(schema.fieldChangeLogs.changedAt, endExclusiveIso),
      ),
    )
    .groupBy(dayExpr);
}

export async function getDashboardTrends(
  db: Database,
  user: User,
  now: Date = new Date(),
): Promise<DashboardTrendsPayload> {
  const { startIso, endExclusiveIso, dates } = getHongKongSeriesUtcBounds(
    now,
    TREND_SERIES_LOOKBACK_DAYS,
    HONG_KONG_TIMEZONE,
  );

  const releaseActions = [
    RECLAMATION_AUDIT_ACTIONS.reclaimed,
    "customer.released_to_pool",
  ];
  const claimActions = ["customer.claimed_from_pool"];

  if (user.role === "admin") {
    const [
      newCustomers,
      validFollowUps,
      enteredNegotiation,
      closedWon,
      releasedToPool,
      claimedFromPool,
    ] = await Promise.all([
      loadDailyCounts(
        countNewCustomersByDay(db, startIso, endExclusiveIso),
        dates,
      ),
      loadDailyCounts(
        countValidFollowUpsByDay(db, startIso, endExclusiveIso),
        dates,
      ),
      loadDailyCounts(
        countStageEntriesByDay(db, startIso, endExclusiveIso, "negotiation"),
        dates,
      ),
      loadDailyCounts(
        countStageEntriesByDay(db, startIso, endExclusiveIso, "closed_won"),
        dates,
      ),
      loadDailyCounts(
        countAuditEventsByDay(db, startIso, endExclusiveIso, releaseActions, {
          distinctEntity: true,
        }),
        dates,
      ),
      loadDailyCounts(
        countAuditEventsByDay(db, startIso, endExclusiveIso, claimActions, {
          distinctEntity: true,
        }),
        dates,
      ),
    ]);

    return {
      role: "admin",
      timezone: "Asia/Hong_Kong",
      defaultMetricKey: "new_customers",
      availableMetrics: ADMIN_TREND_METRICS,
      unavailableMetricKeys: [...UNAVAILABLE_TREND_METRICS],
      dailySeries: {
        new_customers: newCustomers,
        valid_follow_ups: validFollowUps,
        entered_negotiation: enteredNegotiation,
        closed_won: closedWon,
        released_to_pool: releasedToPool,
        claimed_from_pool: claimedFromPool,
      },
    };
  }

  const [
    validFollowUps,
    newCustomers,
    claimedFromPool,
    releasedToPool,
  ] = await Promise.all([
    loadDailyCounts(
      countValidFollowUpsByDay(db, startIso, endExclusiveIso, user.id),
      dates,
    ),
    loadDailyCounts(
      countNewCustomersByDay(db, startIso, endExclusiveIso, user.id),
      dates,
    ),
    loadDailyCounts(
      countAuditEventsByDay(db, startIso, endExclusiveIso, claimActions, {
        actorUserId: user.id,
        distinctEntity: true,
      }),
      dates,
    ),
    loadDailyCounts(
      countAuditEventsByDay(db, startIso, endExclusiveIso, releaseActions, {
        previousOwnerId: user.id,
        distinctEntity: true,
      }),
      dates,
    ),
  ]);

  return {
    role: "staff",
    timezone: "Asia/Hong_Kong",
    defaultMetricKey: "valid_follow_ups",
    availableMetrics: STAFF_TREND_METRICS,
    unavailableMetricKeys: [
      ...UNAVAILABLE_TREND_METRICS,
      "entered_negotiation",
      "closed_won",
    ],
    dailySeries: {
      valid_follow_ups: validFollowUps,
      new_customers: newCustomers,
      claimed_from_pool: claimedFromPool,
      released_to_pool: releasedToPool,
    },
  };
}
