export const dynamic = "force-dynamic";

import { PageIntro } from "@/components/ui/page-intro";
import { UsersClient } from "./users-client";

export default function AdminUsersPage() {
  return (
    <div>
      <PageIntro
        title="用户管理"
        description="创建员工账号、停用/启用、重置密码与解锁。仅管理员可访问。"
      />
      <UsersClient />
    </div>
  );
}
