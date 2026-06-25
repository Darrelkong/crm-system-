import { StaffDashboardClient } from "@/components/dashboard/staff-dashboard-client";
import { RecentAnnouncementsCard } from "@/components/dashboard/recent-announcements-card";
import { RecentNotificationsCard } from "@/components/dashboard/recent-notifications-card";
import { getStaffDashboardStats } from "@/lib/reports/staff-dashboard";
import { getDb } from "@/lib/db";
import type { User } from "../../../drizzle/schema/users";

export async function StaffDashboardView({ user }: { user: User }) {
  const db = getDb();
  const stats = await getStaffDashboardStats(db, user);

  return (
    <div className="space-y-6">
      <StaffDashboardClient stats={stats} />

      <div className="grid gap-6 lg:grid-cols-2">
        <RecentNotificationsCard user={user} />
        <RecentAnnouncementsCard user={user} />
      </div>
    </div>
  );
}
