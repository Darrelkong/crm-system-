export const dynamic = "force-dynamic";

import { BackupsClient } from "./backups-client";

export default function AdminBackupsPage() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">数据库备份</h2>
        <p className="mt-1 text-sm text-slate-500">
          手动触发备份或查看历史记录。备份文件存储于 R2（生产）或本地目录（开发）。
        </p>
      </div>
      <BackupsClient />
    </div>
  );
}
