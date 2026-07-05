import { TranslatedPageHeader } from "@/components/i18n/translated-page-header";
import { DashboardHeaderActions } from "@/components/dashboard/dashboard-header-actions";
import { requireAdminCached } from "@/lib/auth/request-cache";
import { AdminDashboardView } from "@/components/dashboard/admin-dashboard-view";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const user = await requireAdminCached();

  return (
    <div>
      <TranslatedPageHeader
        titleKey="layout.greeting"
        titleParams={{ name: user.displayName }}
        descriptionKey="layout.adminControlCenter"
        action={<DashboardHeaderActions />}
      />
      <AdminDashboardView user={user} />
    </div>
  );
}
