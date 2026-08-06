import { StaffDashboardSummaryClient } from "@/components/dashboard/staff-dashboard-summary-client";
import { DashboardReclamationRiskCard } from "@/components/dashboard/dashboard-reclamation-risk-card";
import { RecentAnnouncementsCard } from "@/components/dashboard/recent-announcements-card";
import { RecentNotificationsCard } from "@/components/dashboard/recent-notifications-card";
import { getDashboardSummary } from "@/lib/reports/dashboard-summary";
import { getDb } from "@/lib/db";
import type { User } from "../../../drizzle/schema/users";

export async function StaffDashboardView({ user }: { user: User }) {
  const db = getDb();
  const summary = await getDashboardSummary(db, user);

  if (summary.role !== "staff") {
    throw new Error("Expected staff dashboard summary");
  }

  return (
    <div className="space-y-6">
      <StaffDashboardSummaryClient summary={summary} />

      <DashboardReclamationRiskCard
        titleKey="dashboard.customerReclamationRisk"
        risk={summary.reclamationRisk}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <RecentNotificationsCard user={user} />
        <RecentAnnouncementsCard user={user} />
      </div>
    </div>
  );
}
