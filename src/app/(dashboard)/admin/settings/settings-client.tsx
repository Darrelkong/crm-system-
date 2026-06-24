"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/form";
import {
  SETTING_KEYS,
  SETTING_LABELS,
  type SettingKey,
} from "@/lib/settings/keys";

export function SettingsClient() {
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
      body: JSON.stringify({ settings }),
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
    return <p className="text-sm text-slate-500">加载中…</p>;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="grid max-w-lg gap-4">
        {SETTING_KEYS.map((key) => (
          <div key={key}>
            <Label htmlFor={key}>{SETTING_LABELS[key as SettingKey]}</Label>
            {key === "business_timezone" ? (
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
            <p className="mt-0.5 font-mono text-xs text-slate-400">{key}</p>
          </div>
        ))}
      </div>
      <div className="mt-6">
        <Button onClick={save} disabled={saving}>
          {saving ? "保存中…" : "保存设置"}
        </Button>
        {message && <p className="mt-2 text-sm text-slate-600">{message}</p>}
      </div>
    </div>
  );
}
