export const dynamic = "force-dynamic";

import { PageIntro } from "@/components/ui/page-intro";
import { AnnouncementsClient } from "./announcements-client";

export default function AnnouncementsPage() {
  return (
    <div>
      <PageIntro title="公告中心" description="查看系统公告与重要通知。" />
      <AnnouncementsClient />
    </div>
  );
}
