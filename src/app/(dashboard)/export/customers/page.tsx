export const dynamic = "force-dynamic";

import { PageIntro } from "@/components/ui/page-intro";
import { ExportCustomersClient } from "./export-customers-client";

export default function ExportCustomersPage() {
  return (
    <div>
      <PageIntro
        title="客户数据导出"
        description="按范围导出客户数据。敏感字段导出需二次确认。"
      />
      <ExportCustomersClient />
    </div>
  );
}
