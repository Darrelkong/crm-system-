export const dynamic = "force-dynamic";

import { AnnouncementsClient } from "./announcements-client";

export default function AnnouncementsPage() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">公告中心</h2>
        <p className="mt-1 text-sm text-slate-500">
          查看管理员发布的系统公告与重要通知。
        </p>
      </div>
      <AnnouncementsClient />
    </div>
  );
}
