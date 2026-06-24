import { Card, PageHeader } from "@/components/ui/card";
import { requireStaff } from "@/lib/permissions/auth";
import { DashboardTaskStats } from "@/components/dashboard/task-stats";

export default async function StaffDashboardPage() {
  const user = await requireStaff();

  return (
    <div>
      <PageHeader
        title={`你好，${user.displayName}`}
        description="员工工作台"
      />
      <DashboardTaskStats user={user} />
      <Card>
        <p className="text-sm text-slate-600">
          你只能为自己负责的客户添加跟进。前往
          <a href="/customers" className="mx-1 text-indigo-600 hover:underline">
            客户管理
          </a>
          查看客户与添加跟进。
        </p>
      </Card>
    </div>
  );
}
