export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/permissions/auth";
import { ApprovalsClient } from "./approvals-client";

export default async function ApprovalsPage() {
  const user = await requireAuth();

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">审批中心</h2>
        <p className="mt-1 text-sm text-slate-500">
          {user.role === "admin"
            ? "查看并处理全部审批申请"
            : "查看自己提交的审批申请及处理结果"}
        </p>
      </div>
      <ApprovalsClient isAdmin={user.role === "admin"} />
    </div>
  );
}
