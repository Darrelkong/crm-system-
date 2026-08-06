import { and, count, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { staffOverdueFollowUpBatchWhere } from "@/lib/reports/dashboard-customer-scopes";
import { getPendingActionCountsByUserIds } from "@/lib/notifications/queries";
import { listActiveStaffUsers } from "@/lib/users/queries";
import type { User } from "../../../../../drizzle/schema/users";

export type AdminAiProviderContext = {
  metrics: {
    newCustomersToday: number;
    validFollowUpsToday: number;
    pendingApprovals: number;
    autoReleaseWithin7Days: number;
    autoReleaseTomorrow: number;
    overdueFollowUps: number;
    publicPoolEnteredToday: number;
    totalCustomers: number;
  };
  teamAggregates: {
    activeStaffCount: number;
    staffWithOverdueCount: number;
    staffWithReclamationRiskCount: number;
    teamPendingItemsTotal: number;
    teamCurrentCustomersTotal: number;
  };
  reclamationRisk: {
    tomorrowCount: number;
    within7Count: number;
    membersAtRiskCount: number;
    pendingRiskCount: number;
  };
  stageDistribution: Array<{ stageKey: string; count: number; percentage: number }>;
  trendSummary: {
    validFollowUpsLast7Days: number;
    newCustomersLast7Days: number;
    stageProgressLast7Days: number;
  };
};

export async function buildAdminAiContext(
  db: Database,
  viewer: User,
  now: Date,
): Promise<{ providerContext: AdminAiProviderContext }> {
  if (viewer.role !== "admin") {
    throw new Error("Admin context requires admin viewer");
  }

  const { getDashboardSummary } = await import("@/lib/reports/dashboard-summary");
  const { getDashboardStageDistribution } = await import(
    "@/lib/reports/dashboard-stage-distribution"
  );
  const { getDashboardTrends } = await import("@/lib/reports/dashboard-trends");

  const [summary, stage, trends, staff] = await Promise.all([
    getDashboardSummary(db, viewer),
    getDashboardStageDistribution(db, viewer),
    getDashboardTrends(db, viewer),
    listActiveStaffUsers(),
  ]);

  if (summary.role !== "admin") {
    throw new Error("Expected admin summary");
  }

  const staffIds = staff.map((member) => member.id);
  const nowIso = now.toISOString();

  const [overdueByOwner, pendingByUser, currentByOwner] = await Promise.all([
    staffIds.length > 0
      ? db
          .select({
            ownerId: schema.customers.ownerId,
            value: count().mapWith(Number),
          })
          .from(schema.customers)
          .where(staffOverdueFollowUpBatchWhere(staffIds, nowIso))
          .groupBy(schema.customers.ownerId)
      : Promise.resolve([]),
    getPendingActionCountsByUserIds(db, staffIds),
    staffIds.length > 0
      ? db
          .select({
            ownerId: schema.customers.ownerId,
            value: count().mapWith(Number),
          })
          .from(schema.customers)
          .where(
            and(
              inArray(schema.customers.ownerId, staffIds),
              isNotNull(schema.customers.ownerId),
            ),
          )
          .groupBy(schema.customers.ownerId)
      : Promise.resolve([]),
  ]);

  const staffWithOverdueCount = overdueByOwner.filter(
    (row) => (row.value ?? 0) > 0,
  ).length;
  const teamPendingItemsTotal = [...pendingByUser.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  const teamCurrentCustomersTotal = currentByOwner.reduce(
    (sum, row) => sum + Number(row.value ?? 0),
    0,
  );

  const validFollowUpsSeries = trends.dailySeries.valid_follow_ups ?? [];
  const newCustomersSeries = trends.dailySeries.new_customers ?? [];
  const stageProgressSeries = trends.dailySeries.entered_negotiation ?? [];

  const providerContext: AdminAiProviderContext = {
    metrics: { ...summary.metrics },
    teamAggregates: {
      activeStaffCount: staffIds.length,
      staffWithOverdueCount,
      staffWithReclamationRiskCount: summary.reclamationRisk.memberCount ?? 0,
      teamPendingItemsTotal,
      teamCurrentCustomersTotal,
    },
    reclamationRisk: {
      tomorrowCount: summary.reclamationRisk.tomorrowCount,
      within7Count: summary.reclamationRisk.within7Count,
      membersAtRiskCount: summary.reclamationRisk.memberCount ?? 0,
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
      stageProgressLast7Days: stageProgressSeries
        .slice(-7)
        .reduce((sum, point) => sum + point.value, 0),
    },
  };

  return { providerContext };
}
