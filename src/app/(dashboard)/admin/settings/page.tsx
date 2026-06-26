export const dynamic = "force-dynamic";

import { PageIntro } from "@/components/ui/page-intro";
import { SettingsClient } from "./settings-client";

export default function AdminSettingsPage() {
  return (
    <div>
      <PageIntro
        title="系统设置"
        description="基础系统参数。本阶段部分配置仅保存，尚未全部接入业务逻辑。"
      />
      <SettingsClient />
    </div>
  );
}
