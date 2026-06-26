export const dynamic = "force-dynamic";

import { PageIntro } from "@/components/ui/page-intro";
import { AdminAnnouncementsClient } from "./announcements-client";

export default function AdminAnnouncementsPage() {
  return (
    <div>
      <PageIntro title="公告管理" description="发布、编辑与管理系统公告。" />
      <AdminAnnouncementsClient />
    </div>
  );
}
