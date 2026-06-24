export const dynamic = "force-dynamic";

import { LoginLogsClient } from "./login-logs-client";

export default function AdminLoginLogsPage() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">登录记录</h2>
        <p className="mt-1 text-sm text-slate-500">最近 100 条登录尝试记录。</p>
      </div>
      <LoginLogsClient />
    </div>
  );
}
