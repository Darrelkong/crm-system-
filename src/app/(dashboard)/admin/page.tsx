import { PageHeader } from "@/components/ui/card";
import { requireAdmin } from "@/lib/permissions/auth";
import { AdminDashboardView } from "@/components/dashboard/admin-dashboard-view";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const user = await requireAdmin();

  return (
    <div>
      <PageHeader
        title={`你好，${user.displayName}`}
        description="管理员数据看板"
      />
      <AdminDashboardView />
    </div>
  );
}
