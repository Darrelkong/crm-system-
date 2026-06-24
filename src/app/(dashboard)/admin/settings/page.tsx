export const dynamic = "force-dynamic";

import { SettingsClient } from "./settings-client";

export default function AdminSettingsPage() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">系统设置</h2>
        <p className="mt-1 text-sm text-slate-500">
          基础系统参数。本阶段部分配置仅保存，尚未全部接入业务逻辑。
        </p>
      </div>
      <SettingsClient />
    </div>
  );
}
