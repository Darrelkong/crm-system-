import { and, count, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { NOTIFICATION_ACTION_STATE } from "@/lib/notifications/action-state";
import { collectReclamationRiskSnapshots } from "@/lib/reclamation/work-items-sync";
import { getEffectiveSettings } from "@/lib/settings/effective";
import { listActiveStaffUsers } from "@/lib/users/queries";
import {
  getHongKongSeriesUtcBounds,
  TREND_RANGE_DAYS,
  type TrendRangeDays,
} from "@/lib/reports/dashboard-trends-period";
import type { User } from "../../../drizzle/schema/users";

export type TeamMemberExecutionRow = {
  userId: string;
  displayName: string;
  currentCustomers: number;
  overdueFollowUps: number;
  autoReleaseWithin7Days: number;
  pendingItems: number;
  periodActivity: Record<
    TrendRangeDays,
    {
      validFollowUps: number;
      stageProgressCustomers: number;
    }
  >;
  customersHref: string;
  overdueHref: string;
};

export type AdminTeamExecutionOverview = {
  role: "admin";
  defaultPeriodDays: TrendRangeDays;
  showStageProgress: boolean;
  members: TeamMemberExecutionRow[];
};

function activeStaffOwnedScope(ownerIds: string[]) {
  return and(
    eq(schema.customers.status, "active"),
    isNull(schema.customers.deletedAt),
    isNotNull(schema.customers.ownerId),
    inArray(schema.customers.ownerId, ownerIds),
  )!;
}

function visiblePendingNotificationSql() {
  return sql`${schema.notifications.type} NOT IN ('auto_reclaim_warning_day_6', 'auto_reclaim_warning_day_7')`;
}

async function countByOwner(
  db: Database,
  ownerIds: string[],
  extraWhere?: ReturnType<typeof and>,
): Promise<Map<string, number>> {
  if (ownerIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      ownerId: schema.customers.ownerId,
      value: count().mapWith(Number),
    })
    .from(schema.customers)
    .where(and(activeStaffOwnedScope(ownerIds), extraWhere))
    .groupBy(schema.customers.ownerId);

  return new Map(
    rows
      .filter((row) => row.ownerId)
      .map((row) => [row.ownerId!, Number(row.value ?? 0)]),
  );
}

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

async function countPendingByUser(
  db: Database,
  userIds: string[],
): Promise<Map<string, number>> {
  if (userIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      userId: schema.notifications.userId,
      value: count().mapWith(Number),
    })
    .from(schema.notifications)
    .where(
      and(
        inArray(schema.notifications.userId, userIds),
        eq(
          schema.notifications.actionState,
          NOTIFICATION_ACTION_STATE.pending,
        ),
        visiblePendingNotificationSql(),
      ),
    )
    .groupBy(schema.notifications.userId);

  return new Map(rows.map((row) => [row.userId, Number(row.value ?? 0)]));
}

function sortStaffByDisplayName<T extends { displayName: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, "en", { sensitivity: "base" }),
  );
}

function buildOwnerHref(ownerId: string, workView?: "overdue"): string {
  const params = new URLSearchParams();
  params.set("ownerId", ownerId);
  if (workView) {
    params.set("workView", workView);
  }
  return `/customers?${params.toString()}`;
}

export async function getAdminTeamExecutionOverview(
  db: Database,
  viewer: User,
  now: Date = new Date(),
): Promise<AdminTeamExecutionOverview> {
  if (viewer.role !== "admin") {
    throw new Error("Admin access required");
  }

  const staff = sortStaffByDisplayName(await listActiveStaffUsers());
  const staffIds = staff.map((member) => member.id);
  const nowIso = now.toISOString();
  const settings = await getEffectiveSettings(db);

  const periodBounds = Object.fromEntries(
    TREND_RANGE_DAYS.map((days) => [
      days,
      getHongKongSeriesUtcBounds(now, days),
    ]),
  ) as Record<TrendRangeDays, ReturnType<typeof getHongKongSeriesUtcBounds>>;

  const periodFollowUpMaps = await Promise.all(
    TREND_RANGE_DAYS.map((days) => {
      const { startIso, endExclusiveIso } = periodBounds[days];
      return countValidFollowUpsByActor(db, staffIds, startIso, endExclusiveIso);
    }),
  );

  const periodStageMaps = await Promise.all(
    TREND_RANGE_DAYS.map((days) => {
      const { startIso, endExclusiveIso } = periodBounds[days];
      return countStageProgressByActor(db, staffIds, startIso, endExclusiveIso);
    }),
  );

  const [currentCustomers, overdueCustomers, pendingByUser, snapshots] =
    await Promise.all([
      countByOwner(db, staffIds),
      countByOwner(
        db,
        staffIds,
        and(
          isNotNull(schema.customers.nextFollowUpAt),
          lt(schema.customers.nextFollowUpAt, nowIso),
        ),
      ),
      countPendingByUser(db, staffIds),
      collectReclamationRiskSnapshots(db, now, settings),
    ]);

  const releaseWithin7ByOwner = new Map<string, number>();
  for (const snapshot of snapshots) {
    if (!staffIds.includes(snapshot.ownerId)) {
      continue;
    }
    if (snapshot.riskBand === "tomorrow" || snapshot.riskBand === "within_7") {
      releaseWithin7ByOwner.set(
        snapshot.ownerId,
        (releaseWithin7ByOwner.get(snapshot.ownerId) ?? 0) + 1,
      );
    }
  }

  const members: TeamMemberExecutionRow[] = staff.map((member) => {
    const periodActivity = {} as TeamMemberExecutionRow["periodActivity"];
    TREND_RANGE_DAYS.forEach((days, index) => {
      periodActivity[days] = {
        validFollowUps: periodFollowUpMaps[index]!.get(member.id) ?? 0,
        stageProgressCustomers: periodStageMaps[index]!.get(member.id) ?? 0,
      };
    });

    return {
      userId: member.id,
      displayName: member.displayName,
      currentCustomers: currentCustomers.get(member.id) ?? 0,
      overdueFollowUps: overdueCustomers.get(member.id) ?? 0,
      autoReleaseWithin7Days: releaseWithin7ByOwner.get(member.id) ?? 0,
      pendingItems: pendingByUser.get(member.id) ?? 0,
      periodActivity,
      customersHref: buildOwnerHref(member.id),
      overdueHref: buildOwnerHref(member.id, "overdue"),
    };
  });

  return {
    role: "admin",
    defaultPeriodDays: 7,
    showStageProgress: true,
    members,
  };
}
