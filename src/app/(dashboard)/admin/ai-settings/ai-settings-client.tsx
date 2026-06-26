"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/form";
import { useTranslation } from "@/i18n/provider";
import {
  AI_ANALYSIS_LANGUAGES,
  AI_PROVIDERS,
  AI_SETTING_KEYS,
  type AiSettingKey,
} from "@/lib/settings/ai-keys";

type ApiResponse = {
  settings?: Record<string, string>;
  apiKeyConfigured?: boolean;
  error?: string;
};

function booleanSelectValue(value: string | undefined): string {
  return value === "false" ? "false" : "true";
}

export function AiSettingsClient({
  initialSettings,
  initialApiKeyConfigured,
}: {
  initialSettings: Record<string, string>;
  initialApiKeyConfigured: boolean;
}) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(initialSettings);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(initialApiKeyConfigured);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/admin/ai-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings }),
    });
    const data = (await res.json()) as ApiResponse;
    if (!res.ok) {
      setMessage(data.error ?? t("aiSettings.saveFailed"));
      setSaving(false);
      return;
    }
    setSettings(data.settings ?? {});
    setApiKeyConfigured(!!data.apiKeyConfigured);
    setMessage(t("aiSettings.saveSuccess"));
    setSaving(false);
  }

  function update(key: AiSettingKey, value: string) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="surface-card p-6">
      <div className="mb-6 rounded-lg border border-[#C5DAF0] bg-[#E8F1FA] p-4 text-sm text-[#172033]">
        <p className="font-medium">{t("aiSettings.apiKeyHintTitle")}</p>
        <p className="mt-1">{t("aiSettings.apiKeyHintBody")}</p>
        <p className="mt-2 font-mono text-xs text-[#1F4E79]">
          wrangler secret put AI_API_KEY
        </p>
        <p className="mt-2">
          {t("aiSettings.apiKeyStatus")}:{" "}
          <span className={apiKeyConfigured ? "text-green-700" : "text-amber-700"}>
            {apiKeyConfigured ? t("aiSettings.apiKeyConfigured") : t("aiSettings.apiKeyMissing")}
          </span>
        </p>
      </div>

      <div className="grid max-w-2xl gap-4">
        <div>
          <Label htmlFor="ai_enabled">{t("aiSettings.aiEnabled")}</Label>
          <Select
            id="ai_enabled"
            className="mt-1"
            value={booleanSelectValue(settings.ai_enabled)}
            onChange={(e) => update("ai_enabled", e.target.value)}
          >
            <option value="true">{t("common.enabled")}</option>
            <option value="false">{t("common.disabled")}</option>
          </Select>
        </div>

        <div>
          <Label htmlFor="ai_provider">{t("aiSettings.aiProvider")}</Label>
          <Select
            id="ai_provider"
            className="mt-1"
            value={settings.ai_provider ?? "mock"}
            onChange={(e) => update("ai_provider", e.target.value)}
          >
            {AI_PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {t(`aiSettings.providers.${provider}`)}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="ai_api_base_url">{t("aiSettings.apiBaseUrl")}</Label>
          <Input
            id="ai_api_base_url"
            className="mt-1"
            value={settings.ai_api_base_url ?? ""}
            onChange={(e) => update("ai_api_base_url", e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="ai_model">{t("aiSettings.model")}</Label>
          <Input
            id="ai_model"
            className="mt-1"
            value={settings.ai_model ?? ""}
            onChange={(e) => update("ai_model", e.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="ai_temperature">{t("aiSettings.temperature")}</Label>
            <Input
              id="ai_temperature"
              type="number"
              step="0.1"
              min={0}
              max={1}
              className="mt-1"
              value={settings.ai_temperature ?? ""}
              onChange={(e) => update("ai_temperature", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ai_max_tokens">{t("aiSettings.maxTokens")}</Label>
            <Input
              id="ai_max_tokens"
              type="number"
              min={256}
              max={4096}
              className="mt-1"
              value={settings.ai_max_tokens ?? ""}
              onChange={(e) => update("ai_max_tokens", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ai_timeout_ms">{t("aiSettings.timeoutMs")}</Label>
            <Input
              id="ai_timeout_ms"
              type="number"
              min={5000}
              max={60000}
              className="mt-1"
              value={settings.ai_timeout_ms ?? ""}
              onChange={(e) => update("ai_timeout_ms", e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="ai_analysis_language">{t("aiSettings.analysisLanguage")}</Label>
          <Select
            id="ai_analysis_language"
            className="mt-1"
            value={settings.ai_analysis_language ?? "zh-Hant"}
            onChange={(e) => update("ai_analysis_language", e.target.value)}
          >
            {AI_ANALYSIS_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {t(`aiSettings.languages.${lang}`)}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="ai_prompt_template">{t("aiSettings.promptTemplate")}</Label>
          <textarea
            id="ai_prompt_template"
            className="surface-input mt-1 min-h-40 w-full px-3 py-2 text-sm"
            value={settings.ai_prompt_template ?? ""}
            onChange={(e) => update("ai_prompt_template", e.target.value)}
          />
          <p className="mt-1 text-xs text-[#6B7890]">{t("aiSettings.promptTemplateHint")}</p>
        </div>

        <div>
          <Label htmlFor="ai_prompt_version">{t("aiSettings.promptVersion")}</Label>
          <Input
            id="ai_prompt_version"
            className="mt-1"
            value={settings.ai_prompt_version ?? ""}
            onChange={(e) => update("ai_prompt_version", e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="ai_show_draft_message">{t("aiSettings.showDraftMessage")}</Label>
          <Select
            id="ai_show_draft_message"
            className="mt-1"
            value={booleanSelectValue(settings.ai_show_draft_message)}
            onChange={(e) => update("ai_show_draft_message", e.target.value)}
          >
            <option value="true">{t("common.yes")}</option>
            <option value="false">{t("common.no")}</option>
          </Select>
        </div>

        <div>
          <Label htmlFor="ai_staff_manual_refresh_enabled">
            {t("aiSettings.staffManualRefreshEnabled")}
          </Label>
          <Select
            id="ai_staff_manual_refresh_enabled"
            className="mt-1"
            value={booleanSelectValue(settings.ai_staff_manual_refresh_enabled)}
            onChange={(e) => update("ai_staff_manual_refresh_enabled", e.target.value)}
          >
            <option value="true">{t("common.yes")}</option>
            <option value="false">{t("common.no")}</option>
          </Select>
        </div>

        <div>
          <Label htmlFor="ai_admin_only_manual_refresh">
            {t("aiSettings.adminOnlyManualRefresh")}
          </Label>
          <Select
            id="ai_admin_only_manual_refresh"
            className="mt-1"
            value={booleanSelectValue(settings.ai_admin_only_manual_refresh)}
            onChange={(e) => update("ai_admin_only_manual_refresh", e.target.value)}
          >
            <option value="true">{t("common.yes")}</option>
            <option value="false">{t("common.no")}</option>
          </Select>
        </div>

        {AI_SETTING_KEYS.map((key) => (
          <p key={key} className="hidden font-mono text-xs text-[#6B7890]">
            {key}
          </p>
        ))}
      </div>

      <div className="mt-6">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? t("aiSettings.saving") : t("aiSettings.save")}
        </Button>
        {message && <p className="mt-2 text-sm text-[#6B7890]">{message}</p>}
      </div>
    </div>
  );
}
