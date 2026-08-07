"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/provider";
import type { Locale } from "@/i18n/config";
import {
  mapAdminPriorityHref,
  mapStaffCategoryHref,
  type DashboardAiPublicInsight,
  type DashboardAiPublicResponse,
  type DashboardAiPublicStaffAction,
} from "@/lib/ai/dashboard-insights/api-response";
import type { DashboardAiUrgency } from "@/lib/ai/dashboard-insights/types";
import { cn } from "@/lib/cn";

type Variant = "staff" | "admin";

type Props = {
  variant: Variant;
};

function urgencyClasses(urgency: DashboardAiUrgency): string {
  switch (urgency) {
    case "urgent":
      return "border-red-200 bg-red-50 text-red-800";
    case "attention":
      return "border-amber-200 bg-amber-50 text-amber-900";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function sourceLabelKey(
  source: DashboardAiPublicResponse["source"],
): string | null {
  if (source === "provider") return "dashboard.aiSourceProvider";
  if (source === "system_fallback") return "dashboard.aiSourceSystemFallback";
  if (source === "mock") return "dashboard.aiSourceMock";
  return null;
}

function statusMessageKey(
  status: DashboardAiPublicResponse["status"],
): string | null {
  switch (status) {
    case "unavailable":
      return "dashboard.aiUnavailable";
    case "timeout":
      return "dashboard.aiTimeout";
    case "rate_limited":
      return "dashboard.aiRateLimited";
    case "disabled":
      return "dashboard.aiDisabled";
    case "invalid_response":
      return "dashboard.aiInvalidResponse";
    default:
      return null;
  }
}

function DashboardAiSkeleton({
  title,
  loadingLabel,
}: {
  title: string;
  loadingLabel: string;
}) {
  return (
    <Card className="p-5" aria-busy="true" aria-label={loadingLabel}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="h-5 w-40 animate-pulse rounded bg-slate-100" />
        <div className="h-9 w-20 animate-pulse rounded-xl bg-slate-100" />
      </div>
      <p className="sr-only">{loadingLabel}</p>
      <div className="mb-3 h-4 w-3/4 max-w-md animate-pulse rounded bg-slate-100" />
      <div className="space-y-3">
        <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
      </div>
      <span className="sr-only">{title}</span>
    </Card>
  );
}

function ActionRow({
  action,
  t,
}: {
  action: DashboardAiPublicStaffAction;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const fallbackHref = mapStaffCategoryHref(action.category);
  const customerHref = action.customer?.href;
  const primaryHref = customerHref ?? fallbackHref;

  return (
    <li
      className={cn(
        "rounded-xl border px-3 py-3 break-words",
        urgencyClasses(action.urgency),
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">{action.title}</p>
          <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">
            {action.reason}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-lg border px-2 py-0.5 text-xs font-medium",
            urgencyClasses(action.urgency),
          )}
        >
          {t(`dashboard.aiUrgency.${action.urgency}`)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {customerHref ? (
          <Link
            href={customerHref}
            className="text-sm font-medium text-sky-700 underline-offset-2 hover:underline"
          >
            {t("dashboard.aiViewCustomer")}
          </Link>
        ) : (
          <Link
            href={primaryHref}
            className="text-sm font-medium text-sky-700 underline-offset-2 hover:underline"
          >
            {t("dashboard.aiGoToItem")}
          </Link>
        )}
      </div>
    </li>
  );
}

export function DashboardAiInsightCard({ variant }: Props) {
  const { t, locale } = useTranslation();
  const [data, setData] = useState<DashboardAiPublicResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const title =
    variant === "admin"
      ? t("dashboard.aiManagementBrief")
      : t("dashboard.aiTodaySuggestions");
  const loadingLabel =
    variant === "admin"
      ? t("dashboard.aiGeneratingBrief")
      : t("dashboard.aiGeneratingSuggestions");

  const fetchInsight = useCallback(
    async (forceRefresh: boolean) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (forceRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setLoadError(false);

      try {
        const params = new URLSearchParams({
          locale: locale as Locale,
        });
        if (forceRefresh) params.set("forceRefresh", "1");
        const res = await fetch(`/api/dashboard/ai-insight?${params}`, {
          signal: controller.signal,
          credentials: "same-origin",
        });
        if (!res.ok) {
          if (!mountedRef.current) return;
          setLoadError(true);
          setData(null);
          return;
        }
        const json = (await res.json()) as DashboardAiPublicResponse;
        if (!mountedRef.current) return;
        setData(json);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        if (!mountedRef.current) return;
        setLoadError(true);
        setData(null);
      } finally {
        inFlightRef.current = false;
        if (!mountedRef.current) return;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [locale],
  );

  useEffect(() => {
    mountedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch dashboard AI on mount / locale change
    void fetchInsight(false);
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, [fetchInsight]);

  const onRefresh = () => {
    if (inFlightRef.current || refreshing || loading) return;
    void fetchInsight(true);
  };

  if (loading && !data) {
    return <DashboardAiSkeleton title={title} loadingLabel={loadingLabel} />;
  }

  const sourceKey = data ? sourceLabelKey(data.source) : null;
  const statusKey = data ? statusMessageKey(data.status) : null;
  const showInsight =
    data?.status === "success" && data.insight != null;
  const insight = showInsight ? (data.insight as DashboardAiPublicInsight) : null;

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {sourceKey ? (
            <p className="mt-1 text-xs font-medium text-slate-500">
              {t(sourceKey)}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onRefresh}
          disabled={refreshing || loading}
          aria-label={t("dashboard.aiRefresh")}
          className="min-h-11 min-w-11 shrink-0"
        >
          {refreshing ? t("dashboard.aiRefreshing") : t("dashboard.aiRefresh")}
        </Button>
      </div>

      {loadError ? (
        <p className="text-sm text-slate-600">{t("dashboard.aiUnavailable")}</p>
      ) : null}

      {!loadError && !showInsight && statusKey ? (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">{t(statusKey)}</p>
          {data?.status === "disabled" && variant === "admin" ? (
            <Link
              href="/admin/ai-settings"
              className="inline-block text-sm font-medium text-sky-700 underline-offset-2 hover:underline"
            >
              {t("dashboard.aiGoToSettings")}
            </Link>
          ) : null}
        </div>
      ) : null}

      {insight?.insightType === "staff_today_actions" ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-800 break-words">
            {insight.headline}
          </p>
          {insight.actions.length === 0 ? (
            <p className="text-sm text-slate-500">{t("dashboard.aiNoActions")}</p>
          ) : (
            <ul className="space-y-3">
              {insight.actions.map((action, index) => (
                <ActionRow
                  key={`${action.title}-${index}`}
                  action={action}
                  t={t}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {insight?.insightType === "admin_management_brief" ? (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-slate-900 break-words">
              {insight.headline}
            </p>
            <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap break-words">
              {insight.summary}
            </p>
          </div>
          {insight.priorities.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-800">
                {t("dashboard.aiManagementPriorities")}
              </h3>
              <ul className="space-y-3">
                {insight.priorities.map((priority, index) => (
                  <li
                    key={`${priority.title}-${index}`}
                    className={cn(
                      "rounded-xl border px-3 py-3 break-words",
                      urgencyClasses(priority.urgency),
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900">
                          {priority.title}
                        </p>
                        <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">
                          {priority.reason}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-lg border px-2 py-0.5 text-xs font-medium",
                          urgencyClasses(priority.urgency),
                        )}
                      >
                        {t(`dashboard.aiUrgency.${priority.urgency}`)}
                      </span>
                    </div>
                    <div className="mt-3">
                      <Link
                        href={mapAdminPriorityHref(priority.category)}
                        className="text-sm font-medium text-sky-700 underline-offset-2 hover:underline"
                      >
                        {t("dashboard.aiGoToItem")}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {insight.cautions.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-800">
                {t("dashboard.aiCautions")}
              </h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                {insight.cautions.map((caution, index) => (
                  <li key={`${caution}-${index}`} className="break-words">
                    {caution}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
