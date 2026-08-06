import { and, isNull } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { staffMyActiveCustomerWhere } from "@/lib/reports/dashboard-customer-scopes";
import { getBusinessTodayRange } from "@/lib/reports/dates";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";
import { collectReclamationRiskSnapshots } from "@/lib/reclamation/work-items-sync";
import { getEffectiveSettings } from "@/lib/settings/effective";
import type { User } from "../../../../../drizzle/schema/users";
import { StaffCustomerRefMap } from "../customer-ref";
import { DASHBOARD_AI_MAX_STAFF_CANDIDATES } from "../constants";

export type StaffAiProviderCustomer = {
  ref: string;
  stage: string | null;
  followUpStatus: "due_today" | "overdue" | "scheduled" | "none";
  overdueHours?: number;
  reclamationDaysRemaining?: number;
  pendingActions: string[];
};

export type StaffAiProviderContext = {
  metrics: {
    dueTodayFollowUps: number;
    overdueFollowUps: number;
    autoReleaseWithin7Days: number;
    autoReleaseTomorrow: number;
    pendingWorkItems: number;
    validFollowUpsToday: number;
    myCustomerCount: number;
  };
  reclamationRisk: {
    tomorrowCount: number;
    within7Count: number;
    pendingRiskCount: number;
  };
  stageDistribution: Array<{ stageKey: string; count: number; percentage: number }>;
  trendSummary: {
    validFollowUpsLast7Days: number;
    newCustomersLast7Days: number;
  };
  customers: StaffAiProviderCustomer[];
};

export type StaffAiContextBundle = {
  providerContext: StaffAiProviderContext;
  refMap: StaffCustomerRefMap;
};

function hoursOverdue(nextFollowUpAt: string | null, now: Date): number | undefined {
  if (!nextFollowUpAt) return undefined;
  const due = new Date(nextFollowUpAt).getTime();
  if (due >= now.getTime()) return undefined;
  return Math.floor((now.getTime() - due) / (60 * 60 * 1000));
}

function classifyFollowUpStatus(
  nextFollowUpAt: string | null,
  now: Date,
  todayStart: string,
  todayEnd: string,
): StaffAiProviderCustomer["followUpStatus"] {
  if (!nextFollowUpAt) return "none";
  if (nextFollowUpAt < now.toISOString()) return "overdue";
  if (nextFollowUpAt >= todayStart && nextFollowUpAt < todayEnd) {
    return "due_today";
  }
  return "scheduled";
}

export async function buildStaffAiContext(
  db: Database,
  viewer: User,
  now: Date,
): Promise<StaffAiContextBundle> {
  if (viewer.role !== "staff") {
    throw new Error("Staff context requires staff viewer");
  }

  const { getDashboardSummary } = await import("@/lib/reports/dashboard-summary");
  const { getDashboardStageDistribution } = await import(
    "@/lib/reports/dashboard-stage-distribution"
  );
  const { getDashboardTrends } = await import("@/lib/reports/dashboard-trends");

  const [summary, stage, trends] = await Promise.all([
    getDashboardSummary(db, viewer),
    getDashboardStageDistribution(db, viewer),
    getDashboardTrends(db, viewer),
  ]);

  if (summary.role !== "staff") {
    throw new Error("Expected staff summary");
  }

  const settings = await getEffectiveSettings(db);
  const { start: todayStart, end: todayEnd } = getBusinessTodayRange(
    now,
    HONG_KONG_TIMEZONE,
  );

  const [candidateRows, riskSnapshots] = await Promise.all([
    db
      .select({
        id: schema.customers.id,
        salesStage: schema.customers.salesStage,
        nextFollowUpAt: schema.customers.nextFollowUpAt,
      })
      .from(schema.customers)
      .where(
        and(
          staffMyActiveCustomerWhere(viewer.id),
          isNull(schema.customers.deletedAt),
        ),
      )
      .limit(100),
    collectReclamationRiskSnapshots(db, now, settings),
  ]);

  const riskByCustomer = new Map(
    riskSnapshots
      .filter((snapshot) => snapshot.ownerId === viewer.id)
      .map((snapshot) => [
        snapshot.customerId,
        Math.max(0, snapshot.reclaimDays - snapshot.idleDays),
      ]),
  );

  const scored = candidateRows
    .map((row) => {
      const followUpStatus = classifyFollowUpStatus(
        row.nextFollowUpAt,
        now,
        todayStart,
        todayEnd,
      );
      const reclamationDaysRemaining = riskByCustomer.get(row.id);
      const priority =
        (followUpStatus === "overdue" ? 100 : 0) +
        (followUpStatus === "due_today" ? 80 : 0) +
        (reclamationDaysRemaining !== undefined && reclamationDaysRemaining <= 7
          ? 60
          : 0);
      return { row, followUpStatus, reclamationDaysRemaining, priority };
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, DASHBOARD_AI_MAX_STAFF_CANDIDATES);

  const refMap = new StaffCustomerRefMap(scored.map((item) => item.row.id));
  for (const item of scored) {
    refMap.attachProviderMetadata(item.row.id, {
      stage: item.row.salesStage,
      followUpStatus: item.followUpStatus,
      overdueHours: hoursOverdue(item.row.nextFollowUpAt, now),
      reclamationDaysRemaining: item.reclamationDaysRemaining,
      pendingActions:
        item.followUpStatus === "overdue"
          ? ["follow_up"]
          : item.reclamationDaysRemaining !== undefined &&
              item.reclamationDaysRemaining <= 7
            ? ["reclamation"]
            : [],
    });
  }

  const validFollowUpsSeries = trends.dailySeries.valid_follow_ups ?? [];
  const newCustomersSeries = trends.dailySeries.new_customers ?? [];

  const providerContext: StaffAiProviderContext = {
    metrics: {
      dueTodayFollowUps: summary.metrics.dueTodayFollowUps,
      overdueFollowUps: summary.metrics.overdueFollowUps,
      autoReleaseWithin7Days: summary.metrics.autoReleaseWithin7Days,
      autoReleaseTomorrow: summary.metrics.autoReleaseTomorrow,
      pendingWorkItems: summary.metrics.pendingWorkItems,
      validFollowUpsToday: summary.metrics.validFollowUpsToday,
      myCustomerCount: summary.metrics.myCustomerCount,
    },
    reclamationRisk: {
      tomorrowCount: summary.reclamationRisk.tomorrowCount,
      within7Count: summary.reclamationRisk.within7Count,
      pendingRiskCount: summary.reclamationRisk.pendingRiskCount,
    },
    stageDistribution: stage.stages
      .filter((bucket) => bucket.count > 0)
      .map((bucket) => ({
        stageKey: bucket.key,
        count: bucket.count,
        percentage: bucket.percentage,
      })),
    trendSummary: {
      validFollowUpsLast7Days: validFollowUpsSeries
        .slice(-7)
        .reduce((sum, point) => sum + point.value, 0),
      newCustomersLast7Days: newCustomersSeries
        .slice(-7)
        .reduce((sum, point) => sum + point.value, 0),
    },
    customers: refMap.toProviderList(),
  };

  return { providerContext, refMap };
}
