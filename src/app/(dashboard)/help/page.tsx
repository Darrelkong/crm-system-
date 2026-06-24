export const dynamic = "force-dynamic";

import { HelpClient } from "./help-client";

export default function HelpPage() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">帮助中心</h2>
        <p className="mt-1 text-sm text-slate-500">
          系统使用说明与业务规则参考。
        </p>
      </div>
      <HelpClient />
    </div>
  );
}
