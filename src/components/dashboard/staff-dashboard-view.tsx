import { StaffDashboardSummaryClient } from "@/components/dashboard/staff-dashboard-summary-client";
import { DashboardAiInsightCard } from "@/components/dashboard/dashboard-ai-insight-card";
import { DashboardReclamationRiskCard } from "@/components/dashboard/dashboard-reclamation-risk-card";
import { DashboardStageDistributionCard } from "@/components/dashboard/dashboard-stage-distribution-card";
import { DashboardTrendsCard } from "@/components/dashboard/dashboard-trends-card";
import { RecentAnnouncementsCard } from "@/components/dashboard/recent-announcements-card";
import { RecentNotificationsCard } from "@/components/dashboard/recent-notifications-card";
import { getDashboardSummary } from "@/lib/reports/dashboard-summary";
import { getDashboardStageDistribution } from "@/lib/reports/dashboard-stage-distribution";
import { getDashboardTrends } from "@/lib/reports/dashboard-trends";
import { getDb } from "@/lib/db";
import type { User } from "../../../drizzle/schema/users";

export async function StaffDashboardView({ user }: { user: User }) {
  const db = getDb();
  const [summary, trendsResult, stageResult] = await Promise.all([
    getDashboardSummary(db, user),
    getDashboardTrends(db, user).then(
      (trends) => ({ trends, error: false as const }),
      () => ({ trends: null, error: true as const }),
    ),
    getDashboardStageDistribution(db, user).then(
      (distribution) => ({ distribution, error: false as const }),
      () => ({ distribution: null, error: true as const }),
    ),
  ]);

  if (summary.role !== "staff") {
    throw new Error("Expected staff dashboard summary");
  }

  return (
    <div className="space-y-6">
      <StaffDashboardSummaryClient summary={summary} />

      <DashboardAiInsightCard variant="staff" />

      <DashboardReclamationRiskCard
        titleKey="dashboard.customerReclamationRisk"
        risk={summary.reclamationRisk}
      />

      <DashboardTrendsCard
        trends={trendsResult.trends}
        error={trendsResult.error}
      />

      <DashboardStageDistributionCard
        distribution={stageResult.distribution}
        error={stageResult.error}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <RecentNotificationsCard user={user} />
        <RecentAnnouncementsCard user={user} />
      </div>
    </div>
  );
}
