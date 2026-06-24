import { PageHeader } from "@/components/ui/card";
import { requireStaff } from "@/lib/permissions/auth";
import { StaffDashboardView } from "@/components/dashboard/staff-dashboard-view";

export const dynamic = "force-dynamic";

export default async function StaffDashboardPage() {
  const user = await requireStaff();

  return (
    <div>
      <PageHeader
        title={`你好，${user.displayName}`}
        description="我的工作台数据"
      />
      <StaffDashboardView user={user} />
    </div>
  );
}
