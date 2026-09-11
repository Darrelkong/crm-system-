import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { requireStaffCached } from "@/lib/auth/request-cache";
import { StaffDashboardView } from "@/components/dashboard/staff-dashboard-view";

export const dynamic = "force-dynamic";

export default async function StaffDashboardPage() {
  const user = await requireStaffCached();

  return (
    <div>
      <DashboardPageHeader
        displayName={user.displayName}
        descriptionKey="brand.dashboardSubtitle"
      />
      <StaffDashboardView user={user} />
    </div>
  );
}
