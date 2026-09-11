import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { requireAdminCached } from "@/lib/auth/request-cache";
import { AdminDashboardView } from "@/components/dashboard/admin-dashboard-view";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const user = await requireAdminCached();

  return (
    <div>
      <DashboardPageHeader
        displayName={user.displayName}
        descriptionKey="layout.adminControlCenter"
      />
      <AdminDashboardView user={user} />
    </div>
  );
}
