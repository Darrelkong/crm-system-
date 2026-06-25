import { TranslatedPageHeader } from "@/components/i18n/translated-page-header";
import { requireAdmin } from "@/lib/permissions/auth";
import { AdminDashboardView } from "@/components/dashboard/admin-dashboard-view";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const user = await requireAdmin();

  return (
    <div>
      <TranslatedPageHeader
        titleKey="layout.greeting"
        titleParams={{ name: user.displayName }}
        descriptionKey="brand.dashboardSubtitle"
      />
      <AdminDashboardView user={user} />
    </div>
  );
}
