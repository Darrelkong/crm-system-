export const dynamic = "force-dynamic";

import { PageIntro } from "@/components/ui/page-intro";
import { HelpClient } from "./help-client";

export default function HelpPage() {
  return (
    <div>
      <PageIntro title="帮助中心" description="系统使用说明与业务规则参考。" />
      <HelpClient />
    </div>
  );
}
