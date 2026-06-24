export const dynamic = "force-dynamic";

import { AdminAnnouncementsClient } from "./announcements-client";

export default function AdminAnnouncementsPage() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">公告管理</h2>
        <p className="mt-1 text-sm text-slate-500">
          创建、发布与归档系统公告；仅管理员可访问。
        </p>
      </div>
      <AdminAnnouncementsClient />
    </div>
  );
}
