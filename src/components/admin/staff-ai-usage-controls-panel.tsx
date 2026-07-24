"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/form";
import { useTranslation } from "@/i18n/provider";
import { AI_LIMITS } from "@/lib/settings/ai-keys";

type StaffUsageRow = {
  userId: string;
  displayName: string;
  used: number;
  remaining: number;
  dailyLimit: number;
  status: "ok" | "limit_reached" | "disabled";
};

type StatsPayload = {
  usageDate: string;
  staffDeepAnalysisEnabled: boolean;
  dailyLimit: number;
  todaySuccessTotal: number;
  todayActiveStaffCount: number;
  staff: StaffUsageRow[];
  staffListLimit?: number;
  hasMore?: boolean;
};

type Props = {
  initialEnabled: string;
  initialDailyLimit: string;
  onSettingsPatch: (patch: Record<string, string>) => Promise<boolean>;
};

export function StaffAiUsageControlsPanel({
  initialEnabled,
  initialDailyLimit,
  onSettingsPatch,
}: Props) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(
    initialEnabled === "true" ? "true" : "false",
  );
  const [limitMode, setLimitMode] = useState(() => {
    const n = Number(initialDailyLimit);
    return AI_LIMITS.staffDailyLimitPresets.includes(
      n as (typeof AI_LIMITS.staffDailyLimitPresets)[number],
    )
      ? String(n)
      : "custom";
  });
  const [customLimit, setCustomLimit] = useState(initialDailyLimit || "3");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setStatsError(null);
    try {
      const res = await fetch("/api/admin/ai-staff-usage");
      if (!res.ok) {
        setStatsError(t("aiSettings.staffUsageLoadFailed"));
        return;
      }
      const data = (await res.json()) as { stats?: StatsPayload };
      setStats(data.stats ?? null);
    } catch {
      setStatsError(t("aiSettings.staffUsageLoadFailed"));
    }
  }, [t]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  async function saveControls() {
    setSaving(true);
    setMessage(null);
    const limitValue =
      limitMode === "custom" ? customLimit.trim() : limitMode;
    const parsed = Number(limitValue);
    if (
      !Number.isInteger(parsed) ||
      parsed < AI_LIMITS.staffDailyLimitMin ||
      parsed > AI_LIMITS.staffDailyLimitMax
    ) {
      setMessage(t("aiSettings.invalidDailyLimit"));
      setSaving(false);
      return;
    }

    const ok = await onSettingsPatch({
      ai_staff_deep_analysis_enabled: enabled,
      ai_staff_daily_limit: String(parsed),
    });
    setMessage(ok ? t("aiSettings.saveSuccess") : t("aiSettings.saveFailed"));
    setSaving(false);
    if (ok) {
      void loadStats();
    }
  }

  return (
    <div className="surface-card mt-6 p-6">
      <h2 className="text-lg font-semibold text-[#172033]">
        {t("aiSettings.staffUsageControlsTitle")}
      </h2>
      <p className="mt-1 text-sm text-[#6B7890]">
        {t("aiSettings.staffUsageControlsHint")}
      </p>

      <div className="mt-4 grid max-w-2xl gap-4">
        <div>
          <Label htmlFor="ai_staff_deep_analysis_enabled">
            {t("aiSettings.staffDeepAnalysisEnabled")}
          </Label>
          <Select
            id="ai_staff_deep_analysis_enabled"
            className="mt-1"
            value={enabled}
            onChange={(e) => setEnabled(e.target.value)}
          >
            <option value="true">{t("common.enabled")}</option>
            <option value="false">{t("common.disabled")}</option>
          </Select>
        </div>

        <div>
          <Label htmlFor="ai_staff_daily_limit_mode">
            {t("aiSettings.staffDailyLimit")}
          </Label>
          <Select
            id="ai_staff_daily_limit_mode"
            className="mt-1"
            value={limitMode}
            onChange={(e) => setLimitMode(e.target.value)}
          >
            {AI_LIMITS.staffDailyLimitPresets.map((n) => (
              <option key={n} value={String(n)}>
                {t("aiSettings.dailyLimitTimes", { count: String(n) })}
              </option>
            ))}
            <option value="custom">{t("aiSettings.dailyLimitCustom")}</option>
          </Select>
        </div>

        {limitMode === "custom" && (
          <div>
            <Label htmlFor="ai_staff_daily_limit_custom">
              {t("aiSettings.dailyLimitCustomValue")}
            </Label>
            <Input
              id="ai_staff_daily_limit_custom"
              className="mt-1"
              inputMode="numeric"
              value={customLimit}
              onChange={(e) => setCustomLimit(e.target.value)}
            />
            <p className="mt-1 text-xs text-[#6B7890]">
              {t("aiSettings.dailyLimitRangeHint", {
                min: String(AI_LIMITS.staffDailyLimitMin),
                max: String(AI_LIMITS.staffDailyLimitMax),
              })}
            </p>
          </div>
        )}

        <p className="text-sm text-[#6B7890]">
          {t("aiSettings.usageResetsHongKong")}
        </p>

        <div>
          <Button onClick={() => void saveControls()} disabled={saving}>
            {saving ? t("aiSettings.saving") : t("aiSettings.saveStaffControls")}
          </Button>
          {message && <p className="mt-2 text-sm text-[#6B7890]">{message}</p>}
        </div>
      </div>

      <div className="mt-8">
        <h3 className="text-base font-medium text-[#172033]">
          {t("aiSettings.todayUsageSummary")}
        </h3>
        {statsError && (
          <p className="mt-2 text-sm text-amber-700">{statsError}</p>
        )}
        {stats && (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[#C5DAF0] bg-[#F7FAFD] p-3">
              <p className="text-xs text-[#6B7890]">
                {t("aiSettings.todaySuccessTotal")}
              </p>
              <p className="mt-1 text-xl font-semibold text-[#172033]">
                {stats.todaySuccessTotal}
              </p>
            </div>
            <div className="rounded-lg border border-[#C5DAF0] bg-[#F7FAFD] p-3">
              <p className="text-xs text-[#6B7890]">
                {t("aiSettings.todayActiveStaffCount")}
              </p>
              <p className="mt-1 text-xl font-semibold text-[#172033]">
                {stats.todayActiveStaffCount}
              </p>
            </div>
            <div className="rounded-lg border border-[#C5DAF0] bg-[#F7FAFD] p-3">
              <p className="text-xs text-[#6B7890]">
                {t("aiSettings.usageDate")}
              </p>
              <p className="mt-1 text-xl font-semibold text-[#172033]">
                {stats.usageDate}
              </p>
            </div>
          </div>
        )}

        {stats && (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[#C5DAF0] text-[#6B7890]">
                <tr>
                  <th className="px-2 py-2 font-medium">
                    {t("aiSettings.staffName")}
                  </th>
                  <th className="px-2 py-2 font-medium">
                    {t("aiSettings.usedToday")}
                  </th>
                  <th className="px-2 py-2 font-medium">
                    {t("aiSettings.remainingToday")}
                  </th>
                  <th className="px-2 py-2 font-medium">
                    {t("aiSettings.usageStatus")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.staff.length === 0 ? (
                  <tr>
                    <td className="px-2 py-3 text-[#6B7890]" colSpan={4}>
                      {t("aiSettings.noStaff")}
                    </td>
                  </tr>
                ) : (
                  stats.staff.map((row) => (
                    <tr key={row.userId} className="border-b border-[#E8F1FA]">
                      <td className="px-2 py-2 text-[#172033]">
                        {row.displayName}
                      </td>
                      <td className="px-2 py-2">{row.used}</td>
                      <td className="px-2 py-2">{row.remaining}</td>
                      <td className="px-2 py-2">
                        {row.status === "disabled"
                          ? t("aiSettings.statusDisabled")
                          : row.status === "limit_reached"
                            ? t("aiSettings.statusLimitReached")
                            : t("aiSettings.statusOk")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {stats.hasMore && (
              <p className="mt-2 text-xs text-[#6B7890]">
                {t("aiSettings.staffListTruncated", {
                  limit: String(
                    stats.staffListLimit ?? stats.staff.length,
                  ),
                })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
