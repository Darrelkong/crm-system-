import { Card, PageHeader } from "@/components/ui/card";
import { requireAdmin } from "@/lib/permissions/auth";
import { DashboardTaskStats } from "@/components/dashboard/task-stats";

export default async function AdminDashboardPage() {
  const user = await requireAdmin();

  return (
    <div>
      <PageHeader
        title={`你好，${user.displayName}`}
        description="管理员工作台"
      />
      <DashboardTaskStats user={user} />
      <Card>
        <p className="text-sm text-slate-600">
          管理员可查看全部客户的跟进任务。前往
          <a href="/customers" className="mx-1 text-indigo-600 hover:underline">
            客户管理
          </a>
          查看客户列表与跟进状态。
        </p>
      </Card>
    </div>
  );
}
