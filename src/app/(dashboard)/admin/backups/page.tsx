export const dynamic = "force-dynamic";

import { PageIntro } from "@/components/ui/page-intro";
import { BackupsClient } from "./backups-client";

export default function AdminBackupsPage() {
  return (
    <div>
      <PageIntro
        title="备份管理"
        description="查看备份记录并手动触发备份任务。"
      />
      <BackupsClient />
    </div>
  );
}
