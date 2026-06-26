import { DashboardHeaderActions } from "@/components/dashboard/dashboard-header-actions";
import { TranslatedPageHeader } from "@/components/i18n/translated-page-header";
import { requireStaff } from "@/lib/permissions/auth";
import { StaffDashboardView } from "@/components/dashboard/staff-dashboard-view";

export const dynamic = "force-dynamic";

export default async function StaffDashboardPage() {
  const user = await requireStaff();

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
