import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  staffOwnedActiveCustomersBatchWhere,
  staffOverdueFollowUpBatchWhere,
} from "@/lib/reports/dashboard-customer-scopes";
import { collectReclamationRiskSnapshots } from "@/lib/reclamation/work-items-sync";
import { getPendingActionCountsByUserIds } from "@/lib/notifications/queries";
import { getEffectiveSettings } from "@/lib/settings/effective";
import { listActiveStaffUsers } from "@/lib/users/queries";
import {
  getHongKongSeriesUtcBounds,
  TREND_RANGE_DAYS,
  type TrendRangeDays,
} from "@/lib/reports/dashboard-trends-period";
import { buildTeamReclamationHref } from "@/lib/reports/dashboard-drilldown-links";
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
  reclamationHref: string;
};

export type AdminTeamExecutionOverview = {
  role: "admin";
  defaultPeriodDays: TrendRangeDays;
  showStageProgress: boolean;
  members: TeamMemberExecutionRow[];
};

type StaffMemberRow = {
  id: string;
  displayName: string;
  email: string;
};

export function sortTeamMembersStable<T extends StaffMemberRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const byName = a.displayName.localeCompare(b.displayName, "en", {
      sensitivity: "base",
    });
    if (byName !== 0) return byName;
    const byEmail = a.email.localeCompare(b.email, "en", {
      sensitivity: "base",
    });
    if (byEmail !== 0) return byEmail;
    return a.id.localeCompare(b.id);
  });
}

async function countCustomersByOwner(
  db: Database,
  scope: ReturnType<typeof and>,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      ownerId: schema.customers.ownerId,
      value: count().mapWith(Number),
    })
    .from(schema.customers)
    .where(scope)
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

  const staff = sortTeamMembersStable(await listActiveStaffUsers());
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
      staffIds.length > 0
        ? countCustomersByOwner(
            db,
            staffOwnedActiveCustomersBatchWhere(staffIds),
          )
        : Promise.resolve(new Map<string, number>()),
      staffIds.length > 0
        ? countCustomersByOwner(
            db,
            staffOverdueFollowUpBatchWhere(staffIds, nowIso),
          )
        : Promise.resolve(new Map<string, number>()),
      getPendingActionCountsByUserIds(db, staffIds),
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
      reclamationHref: buildTeamReclamationHref(member.id),
    };
  });

  return {
    role: "admin",
    defaultPeriodDays: 7,
    showStageProgress: true,
    members,
  };
}
