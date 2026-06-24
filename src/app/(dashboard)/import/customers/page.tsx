export const dynamic = "force-dynamic";

import { ImportCustomersClient } from "./import-customers-client";

export default function ImportCustomersPage() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">客户 CSV 导入</h2>
        <p className="mt-1 text-sm text-slate-500">
          下载模板、上传或粘贴 CSV，预检通过后可批量导入客户。导入客户默认归属当前管理员。
        </p>
      </div>
      <ImportCustomersClient />
    </div>
  );
}
