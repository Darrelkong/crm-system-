export const dynamic = "force-dynamic";

import { PageIntro } from "@/components/ui/page-intro";
import { LoginLogsClient } from "./login-logs-client";

export default function AdminLoginLogsPage() {
  return (
    <div>
      <PageIntro title="登录日志" description="查看系统登录与登出记录。" />
      <LoginLogsClient />
    </div>
  );
}
