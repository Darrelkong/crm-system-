export const dynamic = "force-dynamic";

import { isAiApiKeyConfigured } from "@/lib/ai/env";
import { getAiSettings } from "@/lib/settings/ai-service";
import { AiSettingsClient } from "./ai-settings-client";

export default async function AdminAiSettingsPage() {
  const settings = await getAiSettings();
  const apiKeyConfigured = isAiApiKeyConfigured();

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">AI 设置</h2>
        <p className="mt-1 text-sm text-slate-500">
          配置客户意向 AI 分析。API Key 不在后台保存，请使用 Cloudflare Secret。
        </p>
      </div>
      <AiSettingsClient
        initialSettings={settings}
        initialApiKeyConfigured={apiKeyConfigured}
      />
    </div>
  );
}
