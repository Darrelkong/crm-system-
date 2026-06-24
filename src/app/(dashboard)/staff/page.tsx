import { Card, PageHeader } from "@/components/ui/card";
import { requireStaff } from "@/lib/permissions/auth";

export default async function StaffDashboardPage() {
  const user = await requireStaff();

  return (
    <div>
      <PageHeader
        title={`你好，${user.displayName}`}
        description="员工首页。你只能查看和管理自己负责的客户（后续实现）。"
      />
      <Card>
        <p className="text-sm text-slate-600">
          当前为 Phase 1 占位页面。客户新增、列表与权限过滤将在 Phase 3 实现。
        </p>
      </Card>
    </div>
  );
}
