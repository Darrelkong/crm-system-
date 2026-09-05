import { AdminDashboardSummaryClient } from "@/components/dashboard/admin-dashboard-summary-client";
import { AdminDashboardClient } from "@/components/dashboard/admin-dashboard-client";
import { AdminTeamExecutionCard } from "@/components/dashboard/admin-team-execution-card";
import { DashboardAiInsightCard } from "@/components/dashboard/dashboard-ai-insight-card";
import { DashboardReclamationRiskCard } from "@/components/dashboard/dashboard-reclamation-risk-card";
import { DashboardStageDistributionCard } from "@/components/dashboard/dashboard-stage-distribution-card";
import { DashboardTrendsCard } from "@/components/dashboard/dashboard-trends-card";
import { RecentAnnouncementsCard } from "@/components/dashboard/recent-announcements-card";
import { RecentNotificationsCard } from "@/components/dashboard/recent-notifications-card";
import { loadAdminDashboardReports } from "@/lib/reports/admin-dashboard-orchestration";
import { getDb, schema } from "@/lib/db";
import type { User } from "../../../drizzle/schema/users";
import { eq, sql } from "drizzle-orm";

export async function AdminDashboardView({ user }: { user: User }) {
  const db = getDb();
  const now = new Date();
  const { summary, legacyStats, trendsResult, stageResult, teamResult } =
    await loadAdminDashboardReports(db, user, now);
  const [pendingDevices] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.authorizedDevices)
    .where(eq(schema.authorizedDevices.status, "pending"));

  return (
    <div className="space-y-6">
      <AdminDashboardSummaryClient
        summary={summary}
        pendingDeviceApprovals={Number(pendingDevices?.count ?? 0)}
      />

      <DashboardAiInsightCard variant="admin" />

      <DashboardReclamationRiskCard
        titleKey="dashboard.teamCustomerReclamationRisk"
        risk={summary.reclamationRisk}
        showMemberCount
      />

      <DashboardTrendsCard
        trends={trendsResult.trends}
        error={trendsResult.error}
      />

      <DashboardStageDistributionCard
        distribution={stageResult.distribution}
        error={stageResult.error}
      />

      <AdminTeamExecutionCard
        overview={teamResult.overview}
        error={teamResult.error}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <RecentNotificationsCard user={user} />
        <RecentAnnouncementsCard user={user} />
      </div>

      <AdminDashboardClient stats={legacyStats} />
    </div>
  );
}
