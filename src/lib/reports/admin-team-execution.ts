import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  staffOwnedActiveCustomersBatchWhere,
  staffOverdueFollowUpBatchWhere,
} from "@/lib/reports/dashboard-customer-scopes";
import { collectReclamationRiskSnapshots } from "@/lib/reclamation/work-items-sync";
import { getPendingActionCountsByUserIds } from "@/lib/notifications/queries";
import { getEffectiveSettings, type EffectiveSettings } from "@/lib/settings/effective";
import { listActiveStaffUsers } from "@/lib/users/queries";
import type { ReclamationRiskSnapshot } from "@/lib/reclamation/risk-snapshot";
import {
  recordAdminDashboardReclamationSnapshotPhysicalLoad,
  recordAdminDashboardSettingsPhysicalLoad,
} from "./admin-dashboard-request-instrumentation";
import {
  recordTeamFollowUpPeriodPhysicalLoad,
  recordTeamStagePeriodPhysicalLoad,
} from "./admin-team-execution-instrumentation";
import {
  getHongKongSeriesUtcBounds,
  TREND_RANGE_DAYS,
  type TrendRangeDays,
} from "@/lib/reports/dashboard-trends-period";
import type { User } from "../../../drizzle/schema/users";

export type AdminTeamExecutionRequestOptions = {
  settings?: EffectiveSettings;
  reclamationSnapshots?: ReclamationRiskSnapshot[];
  reclamationSnapshotsFailed?: boolean;
};

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

type StaffMemberRow = {
  id: string;
  displayName: string;
  email: string;
};

export type TeamPeriodBounds = Record<
  TrendRangeDays,
  { startIso: string; endExclusiveIso: string }
>;

export type TeamPeriodMaps = Record<TrendRangeDays, Map<string, number>>;

function emptyTeamPeriodMaps(): TeamPeriodMaps {
  return { 7: new Map(), 30: new Map(), 90: new Map() };
}

function followUpRowsToPeriodMaps(
  rows: Array<{
    userId: string;
    validFollowUps7: number;
    validFollowUps30: number;
    validFollowUps90: number;
  }>,
): TeamPeriodMaps {
  const maps = emptyTeamPeriodMaps();
  for (const row of rows) {
    maps[7].set(row.userId, Number(row.validFollowUps7 ?? 0));
    maps[30].set(row.userId, Number(row.validFollowUps30 ?? 0));
    maps[90].set(row.userId, Number(row.validFollowUps90 ?? 0));
  }
  return maps;
}

function stageRowsToPeriodMaps(
  rows: Array<{
    actorId: string;
    stageProgress7: number;
    stageProgress30: number;
    stageProgress90: number;
  }>,
): TeamPeriodMaps {
  const maps = emptyTeamPeriodMaps();
  for (const row of rows) {
    maps[7].set(row.actorId, Number(row.stageProgress7 ?? 0));
    maps[30].set(row.actorId, Number(row.stageProgress30 ?? 0));
    maps[90].set(row.actorId, Number(row.stageProgress90 ?? 0));
  }
  return maps;
}

/** One bounded follow-up scan for 7/30/90 valid follow-up counts per staff actor. */
export async function loadConsolidatedValidFollowUpPeriodMaps(
  db: Database,
  actorIds: string[],
  periodBounds: TeamPeriodBounds,
): Promise<TeamPeriodMaps> {
  if (actorIds.length === 0) {
    return emptyTeamPeriodMaps();
  }

  recordTeamFollowUpPeriodPhysicalLoad();

  const start7 = periodBounds[7].startIso;
  const start30 = periodBounds[30].startIso;
  const start90 = periodBounds[90].startIso;
  const endExclusiveIso = periodBounds[7].endExclusiveIso;

  const rows = await db
    .select({
      userId: schema.followUps.userId,
      validFollowUps7:
        sql<number>`sum(case when ${schema.followUps.followUpTime} >= ${start7} then 1 else 0 end)`.mapWith(
          Number,
        ),
      validFollowUps30:
        sql<number>`sum(case when ${schema.followUps.followUpTime} >= ${start30} then 1 else 0 end)`.mapWith(
          Number,
        ),
      validFollowUps90: count().mapWith(Number),
    })
    .from(schema.followUps)
    .where(
      and(
        inArray(schema.followUps.userId, actorIds),
        eq(schema.followUps.isValidFollowUp, 1),
        gte(schema.followUps.followUpTime, start90),
        lt(schema.followUps.followUpTime, endExclusiveIso),
      ),
    )
    .groupBy(schema.followUps.userId);

  return followUpRowsToPeriodMaps(rows);
}

/** One bounded stage-change scan for 7/30/90 distinct customer counts per actor. */
export async function loadConsolidatedStageProgressPeriodMaps(
  db: Database,
  actorIds: string[],
  periodBounds: TeamPeriodBounds,
): Promise<TeamPeriodMaps> {
  if (actorIds.length === 0) {
    return emptyTeamPeriodMaps();
  }

  recordTeamStagePeriodPhysicalLoad();

  const start7 = periodBounds[7].startIso;
  const start30 = periodBounds[30].startIso;
  const start90 = periodBounds[90].startIso;
  const endExclusiveIso = periodBounds[7].endExclusiveIso;

  const rows = await db
    .select({
      actorId: schema.fieldChangeLogs.changedBy,
      stageProgress7:
        sql<number>`count(distinct case when ${schema.fieldChangeLogs.changedAt} >= ${start7} then ${schema.fieldChangeLogs.customerId} end)`.mapWith(
          Number,
        ),
      stageProgress30:
        sql<number>`count(distinct case when ${schema.fieldChangeLogs.changedAt} >= ${start30} then ${schema.fieldChangeLogs.customerId} end)`.mapWith(
          Number,
        ),
      stageProgress90:
        sql<number>`count(distinct case when ${schema.fieldChangeLogs.changedAt} >= ${start90} then ${schema.fieldChangeLogs.customerId} end)`.mapWith(
          Number,
        ),
    })
    .from(schema.fieldChangeLogs)
    .where(
      and(
        eq(schema.fieldChangeLogs.fieldName, "sales_stage"),
        inArray(schema.fieldChangeLogs.changedBy, actorIds),
        gte(schema.fieldChangeLogs.changedAt, start90),
        lt(schema.fieldChangeLogs.changedAt, endExclusiveIso),
      ),
    )
    .groupBy(schema.fieldChangeLogs.changedBy);

  return stageRowsToPeriodMaps(rows);
}

async function loadTeamPeriodActivityMaps(
  db: Database,
  actorIds: string[],
  periodBounds: TeamPeriodBounds,
): Promise<{
  followUps: TeamPeriodMaps;
  stageProgress: TeamPeriodMaps;
}> {
  const [followUps, stageProgress] = await Promise.all([
    loadConsolidatedValidFollowUpPeriodMaps(db, actorIds, periodBounds),
    loadConsolidatedStageProgressPeriodMaps(db, actorIds, periodBounds),
  ]);
  return { followUps, stageProgress };
}

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
  requestOptions?: AdminTeamExecutionRequestOptions,
): Promise<AdminTeamExecutionOverview> {
  if (viewer.role !== "admin") {
    throw new Error("Admin access required");
  }

  const staff = sortTeamMembersStable(await listActiveStaffUsers());
  const staffIds = staff.map((member) => member.id);
  const nowIso = now.toISOString();
  let settings: EffectiveSettings;
  if (requestOptions?.settings) {
    settings = requestOptions.settings;
  } else {
    recordAdminDashboardSettingsPhysicalLoad();
    settings = await getEffectiveSettings(db);
  }

  const periodBounds: TeamPeriodBounds = {
    7: getHongKongSeriesUtcBounds(now, 7),
    30: getHongKongSeriesUtcBounds(now, 30),
    90: getHongKongSeriesUtcBounds(now, 90),
  };

  const { followUps: periodFollowUpMaps, stageProgress: periodStageMaps } =
    await loadTeamPeriodActivityMaps(db, staffIds, periodBounds);

  const resolveReclamationSnapshots = async (): Promise<
    ReclamationRiskSnapshot[]
  > => {
    if (requestOptions?.reclamationSnapshotsFailed) {
      throw new Error("reclamation snapshots unavailable");
    }
    if (requestOptions?.reclamationSnapshots !== undefined) {
      return requestOptions.reclamationSnapshots;
    }
    recordAdminDashboardReclamationSnapshotPhysicalLoad();
    return collectReclamationRiskSnapshots(db, now, settings);
  };

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
      resolveReclamationSnapshots(),
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
    for (const days of TREND_RANGE_DAYS) {
      periodActivity[days] = {
        validFollowUps: periodFollowUpMaps[days].get(member.id) ?? 0,
        stageProgressCustomers: periodStageMaps[days].get(member.id) ?? 0,
      };
    }

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
