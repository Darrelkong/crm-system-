import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  TREND_RANGE_DAYS,
  type TrendRangeDays,
} from "@/lib/reports/dashboard-trends-period";

export type TeamPeriodBounds = Record<
  TrendRangeDays,
  { startIso: string; endExclusiveIso: string }
>;

export type TeamPeriodMaps = Record<TrendRangeDays, Map<string, number>>;

/** Legacy reference: one follow-up aggregate per period window. */
async function countValidFollowUpsByActor(
  db: Database,
  actorIds: string[],
  startIso: string,
  endExclusiveIso: string,
): Promise<Map<string, number>> {
  if (actorIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      userId: schema.followUps.userId,
      value: count().mapWith(Number),
    })
    .from(schema.followUps)
    .where(
      and(
        inArray(schema.followUps.userId, actorIds),
        eq(schema.followUps.isValidFollowUp, 1),
        gte(schema.followUps.followUpTime, startIso),
        lt(schema.followUps.followUpTime, endExclusiveIso),
      ),
    )
    .groupBy(schema.followUps.userId);

  return new Map(rows.map((row) => [row.userId, Number(row.value ?? 0)]));
}

/** Legacy reference: one stage-progress aggregate per period window. */
async function countStageProgressByActor(
  db: Database,
  actorIds: string[],
  startIso: string,
  endExclusiveIso: string,
): Promise<Map<string, number>> {
  if (actorIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      actorId: schema.fieldChangeLogs.changedBy,
      value: sql<number>`count(distinct ${schema.fieldChangeLogs.customerId})`.mapWith(
        Number,
      ),
    })
    .from(schema.fieldChangeLogs)
    .where(
      and(
        eq(schema.fieldChangeLogs.fieldName, "sales_stage"),
        inArray(schema.fieldChangeLogs.changedBy, actorIds),
        gte(schema.fieldChangeLogs.changedAt, startIso),
        lt(schema.fieldChangeLogs.changedAt, endExclusiveIso),
      ),
    )
    .groupBy(schema.fieldChangeLogs.changedBy);

  return new Map(rows.map((row) => [row.actorId, Number(row.value ?? 0)]));
}

/** Legacy reference: 3 follow-up queries, then 3 stage queries (2 serial waves). */
export async function loadLegacyTeamPeriodMaps(
  db: Database,
  actorIds: string[],
  periodBounds: TeamPeriodBounds,
): Promise<{
  followUps: TeamPeriodMaps;
  stageProgress: TeamPeriodMaps;
}> {
  const periodFollowUpMaps = await Promise.all(
    TREND_RANGE_DAYS.map((days) => {
      const { startIso, endExclusiveIso } = periodBounds[days];
      return countValidFollowUpsByActor(db, actorIds, startIso, endExclusiveIso);
    }),
  );

  const periodStageMaps = await Promise.all(
    TREND_RANGE_DAYS.map((days) => {
      const { startIso, endExclusiveIso } = periodBounds[days];
      return countStageProgressByActor(db, actorIds, startIso, endExclusiveIso);
    }),
  );

  return {
    followUps: {
      7: periodFollowUpMaps[0]!,
      30: periodFollowUpMaps[1]!,
      90: periodFollowUpMaps[2]!,
    },
    stageProgress: {
      7: periodStageMaps[0]!,
      30: periodStageMaps[1]!,
      90: periodStageMaps[2]!,
    },
  };
}
