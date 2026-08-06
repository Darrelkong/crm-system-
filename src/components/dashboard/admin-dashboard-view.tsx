import { AdminDashboardSummaryClient } from "@/components/dashboard/admin-dashboard-summary-client";
import { AdminDashboardClient } from "@/components/dashboard/admin-dashboard-client";
import { DashboardReclamationRiskCard } from "@/components/dashboard/dashboard-reclamation-risk-card";
import { RecentAnnouncementsCard } from "@/components/dashboard/recent-announcements-card";
import { RecentNotificationsCard } from "@/components/dashboard/recent-notifications-card";
import { getDashboardSummary } from "@/lib/reports/dashboard-summary";
import { getAdminDashboardStats } from "@/lib/reports/admin-dashboard";
import { getDb } from "@/lib/db";
import type { User } from "../../../drizzle/schema/users";

export async function AdminDashboardView({ user }: { user: User }) {
  const db = getDb();
  const [summary, legacyStats] = await Promise.all([
    getDashboardSummary(db, user),
    getAdminDashboardStats(db),
  ]);

  if (summary.role !== "admin") {
    throw new Error("Expected admin dashboard summary");
  }

  return (
    <div className="space-y-6">
      <AdminDashboardSummaryClient summary={summary} />

      <DashboardReclamationRiskCard
        titleKey="dashboard.teamCustomerReclamationRisk"
        risk={summary.reclamationRisk}
        showMemberCount
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <RecentNotificationsCard user={user} />
        <RecentAnnouncementsCard user={user} />
      </div>

      <AdminDashboardClient stats={legacyStats} />
    </div>
  );
}
