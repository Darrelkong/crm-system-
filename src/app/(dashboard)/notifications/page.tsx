export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/permissions/auth";
import { NotificationsClient } from "./notifications-client";

export default async function NotificationsPage() {
  const user = await requireAuth();

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">通知中心</h2>
        <p className="mt-1 text-sm text-slate-500">
          查看系统自动推送的业务通知，点击可跳转相关客户或审批。
        </p>
      </div>
      <NotificationsClient userRole={user.role} />
    </div>
  );
}
