export const dynamic = "force-dynamic";

import { ExportCustomersClient } from "./export-customers-client";

export default function ExportCustomersPage() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">客户数据导出</h2>
        <p className="mt-1 text-sm text-slate-500">
          导出客户 CSV 文件。仅管理员可访问，导出行为将记录审计日志。
        </p>
      </div>
      <ExportCustomersClient />
    </div>
  );
}
