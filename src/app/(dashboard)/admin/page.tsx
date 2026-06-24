import { Card, PageHeader } from "@/components/ui/card";
import { requireAdmin } from "@/lib/permissions/auth";

export default async function AdminDashboardPage() {
  const user = await requireAdmin();

  return (
    <div>
      <PageHeader
        title={`你好，${user.displayName}`}
        description="管理员首页。客户管理、审计日志等功能将在后续阶段开放。"
      />
      <Card>
        <p className="text-sm text-slate-600">
          当前为 Phase 1 占位页面。你已以管理员身份登录，可访问全部后台能力（后续实现）。
        </p>
      </Card>
    </div>
  );
}
