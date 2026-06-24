export const dynamic = "force-dynamic";

import { UsersClient } from "./users-client";

export default function AdminUsersPage() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">用户管理</h2>
        <p className="mt-1 text-sm text-slate-500">
          创建员工账号、停用/启用、重置密码与解锁。仅管理员可访问。
        </p>
      </div>
      <UsersClient />
    </div>
  );
}
