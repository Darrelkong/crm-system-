export const dynamic = "force-dynamic";

import { PageIntro } from "@/components/ui/page-intro";
import { isAiApiKeyConfigured } from "@/lib/ai/env";
import { getAiSettings } from "@/lib/settings/ai-service";
import { AiSettingsClient } from "./ai-settings-client";
import { AiEffectStatsPanel } from "@/components/admin/ai-effect-stats-panel";

export default async function AdminAiSettingsPage() {
  const settings = await getAiSettings();
  const apiKeyConfigured = isAiApiKeyConfigured();

  return (
    <div>
      <PageIntro
        title="AI 设置"
        description="配置客户意向 AI 分析。API Key 不在后台保存，请使用 Cloudflare Secret。"
      />
      <AiSettingsClient
        initialSettings={settings}
        initialApiKeyConfigured={apiKeyConfigured}
      />
      <AiEffectStatsPanel />
    </div>
  );
}
