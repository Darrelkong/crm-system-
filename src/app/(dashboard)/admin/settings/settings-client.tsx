"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/form";
import { INACTIVITY_LOGOUT_MINUTES } from "@/lib/auth/constants";
import { useTranslation } from "@/i18n/provider";
import {
  isHiddenSettingKey,
  isLockedSettingKey,
  SETTING_KEYS,
  SETTING_LABELS,
  type SettingKey,
} from "@/lib/settings/keys";

const VISIBLE_SETTING_KEYS: readonly SettingKey[] = SETTING_KEYS.filter(
  (key) => !isHiddenSettingKey(key),
);

const BOOLEAN_SETTING_KEYS: readonly SettingKey[] = ["device_authorization_enabled"];

function isBooleanSettingKey(key: string): boolean {
  return (BOOLEAN_SETTING_KEYS as readonly string[]).includes(key);
}

function isSettingEnabled(value: string | undefined): boolean {
  return value === "true";
}

function DeviceAuthorizationToggle({
  id,
  enabled,
  onChange,
}: {
  id: string;
  enabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="mt-1">
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={enabled}
        onClick={() => onChange(!enabled)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
          enabled ? "bg-[#2563EB]" : "bg-[#CBD5E1] dark:bg-[#3A4459]"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
      <p className="mt-1 text-xs text-[#6B7890]">
        {enabled
          ? "设备授权已启用，员工新设备需要管理员批准"
          : "设备授权未启用，员工登录不受设备限制"}
      </p>
    </div>
  );
}

function buildSavePayload(settings: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => !isLockedSettingKey(key)),
  );
}

export function SettingsClient() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/settings");
    const data = (await res.json()) as { settings?: Record<string, string> };
    setSettings(data.settings ?? {});
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: buildSavePayload(settings) }),
    });
    const data = (await res.json()) as {
      settings?: Record<string, string>;
      error?: string;
    };
    if (!res.ok) {
      setMessage(data.error ?? "保存失败");
      setSaving(false);
      return;
    }
    setSettings(data.settings ?? {});
    setMessage("设置已保存");
    setSaving(false);
  }

  if (loading) {
    return <p className="text-sm text-[#6B7890]">加载中…</p>;
  }

  return (
    <div className="surface-card p-6">
      <div className="grid max-w-lg gap-4">
        <p className="text-xs text-[#6B7890]">
          {t("settings.reclaimHelperText")}
        </p>
        {VISIBLE_SETTING_KEYS.map((key) => (
          <div key={key}>
            <Label htmlFor={key}>{SETTING_LABELS[key as SettingKey]}</Label>
            {isBooleanSettingKey(key) ? (
              <DeviceAuthorizationToggle
                id={key}
                enabled={isSettingEnabled(settings[key])}
                onChange={(next) =>
                  setSettings((s) => ({ ...s, [key]: next ? "true" : "false" }))
                }
              />
            ) : key === "business_timezone" ? (
              <Select
                id={key}
                className="mt-1"
                value={settings[key] ?? ""}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, [key]: e.target.value }))
                }
              >
                <option value="Asia/Shanghai">Asia/Shanghai</option>
                <option value="UTC">UTC</option>
              </Select>
            ) : key === "inactivity_logout_minutes" ? (
              <>
                <Input
                  id={key}
                  type="number"
                  className="mt-1"
                  value={String(INACTIVITY_LOGOUT_MINUTES)}
                  readOnly
                  disabled
                />
                <p className="mt-1 text-xs text-[#6B7890]">
                  {t("settings.inactivityLogoutFixedHint")}
                </p>
              </>
            ) : (
              <Input
                id={key}
                type="number"
                min={1}
                className="mt-1"
                value={settings[key] ?? ""}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, [key]: e.target.value }))
                }
              />
            )}
            <p className="mt-0.5 font-mono text-xs text-[#6B7890]">{key}</p>
          </div>
        ))}
      </div>
      <div className="mt-6">
        <Button onClick={save} disabled={saving}>
          {saving ? "保存中…" : "保存设置"}
        </Button>
        {message && <p className="mt-2 text-sm text-[#6B7890]">{message}</p>}
      </div>
    </div>
  );
}
