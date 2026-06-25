import { AdminDashboardClient } from "@/components/dashboard/admin-dashboard-client";
import { RecentAnnouncementsCard } from "@/components/dashboard/recent-announcements-card";
import { RecentNotificationsCard } from "@/components/dashboard/recent-notifications-card";
import { getAdminDashboardStats } from "@/lib/reports/admin-dashboard";
import { getDb } from "@/lib/db";
import type { User } from "../../../drizzle/schema/users";

export async function AdminDashboardView({ user }: { user: User }) {
  const db = getDb();
  const stats = await getAdminDashboardStats(db);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <RecentNotificationsCard user={user} />
        <RecentAnnouncementsCard user={user} />
      </div>

      <AdminDashboardClient stats={stats} />
    </div>
  );
}
