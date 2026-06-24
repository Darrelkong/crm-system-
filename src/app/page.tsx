import { Card, PageHeader } from "@/components/ui/card";
import { defaultLocale } from "@/i18n/config";
import { getMessages } from "@/i18n";

export default function HomePage() {
  const messages = getMessages(defaultLocale);

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center p-8">
      <PageHeader
        title={messages.common.phase0Title}
        description={messages.common.phase0Description}
      />
      <Card>
        <p className="text-sm text-slate-600">
          当前阶段：Phase 0 — Cloudflare + D1 基础设施。数据库迁移与健康检查 API
          已就绪。
        </p>
        <p className="mt-3 text-sm text-slate-500">
          健康检查：<code className="rounded bg-slate-100 px-1">GET /api/health</code>
        </p>
      </Card>
    </div>
  );
}
