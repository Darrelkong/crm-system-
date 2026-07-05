import { DashboardHeaderActions } from "@/components/dashboard/dashboard-header-actions";
import { TranslatedPageHeader } from "@/components/i18n/translated-page-header";
import { requireStaffCached } from "@/lib/auth/request-cache";
import { StaffDashboardView } from "@/components/dashboard/staff-dashboard-view";

export const dynamic = "force-dynamic";

export default async function StaffDashboardPage() {
  const user = await requireStaffCached();

  return (
    <div>
      <TranslatedPageHeader
        titleKey="layout.greeting"
        titleParams={{ name: user.displayName }}
        descriptionKey="brand.dashboardSubtitle"
        action={<DashboardHeaderActions />}
      />
      <StaffDashboardView user={user} />
    </div>
  );
}
