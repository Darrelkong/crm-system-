"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import type {
  CustomerAiInsightDisplayMeta,
  CustomerAiInsightView,
} from "@/lib/ai/customer-insights/service";
import { formatHongKongDateTime } from "@/lib/timezone";

const INTENT_BADGE_CLASS: Record<string, string> = {
  high: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  medium: "bg-amber-50 text-amber-800 ring-amber-200",
  low: "bg-[#EEF3F8] text-[#6B7890] ring-[#E3E8F0]",
  unknown: "bg-[#EEF3F8] text-[#6B7890] ring-[#E3E8F0]",
};

type InsightBundle = {
  insight: CustomerAiInsightView | null;
  display: CustomerAiInsightDisplayMeta;
};

function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  return formatHongKongDateTime(value, "");
}

function SignalList({
  title,
  items,
  emptyText,
  variant,
}: {
  title: string;
  items: string[];
  emptyText: string;
  variant: "positive" | "risk" | "missing";
}) {
  const dotClass =
    variant === "positive"
      ? "bg-green-500"
      : variant === "risk"
        ? "bg-amber-500"
        : "bg-[#6B7890]";

  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-[#6B7890]">{title}</h4>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {items.map((item) => (
            <li key={item} className="flex gap-2 text-sm text-[#172033]">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-[#6B7890]">{emptyText}</p>
      )}
    </div>
  );
}

function resolveRefreshErrorMessage(
  t: ReturnType<typeof useCustomerLabels>["t"],
  errorCode?: string,
): string {
  switch (errorCode) {
    case "AI_NOT_CONFIGURED":
    case "AI_CONFIG_ERROR":
      return t("customers.aiInsight.notConfigured");
    case "AI_ANALYSIS_FAILED":
      return t("customers.aiInsight.analysisFailed");
    case "AI_REFRESH_DENIED":
      return t("customers.aiInsight.refreshDenied");
    default:
      return t("customers.aiInsight.refreshFailed");
  }
}

export function CustomerAiInsightPanel({ customerId }: { customerId: string }) {
  const { t } = useCustomerLabels();
  const [insight, setInsight] = useState<CustomerAiInsightView | null>(null);
  const [display, setDisplay] = useState<CustomerAiInsightDisplayMeta>({
    showDraftMessage: true,
    canRefresh: true,
    refreshDisabledReason: null,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void fetch(`/api/customers/${customerId}/ai-insight`)
      .then(async (response) => {
        if (response.status === 403) {
          return { restricted: true as const };
        }
        if (!response.ok) {
          throw new Error(t("customers.aiInsight.loadFailed"));
        }
        return response.json() as Promise<InsightBundle>;
      })
      .then((result) => {
        if (cancelled) return;
        if ("restricted" in result && result.restricted) {
          setRestricted(true);
          setInsight(null);
          return;
        }
        const bundle = result as InsightBundle;
        setInsight(bundle.insight);
        setDisplay(bundle.display);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("customers.aiInsight.loadFailed"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [customerId, t]);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch(`/api/customers/${customerId}/ai-insight/refresh`, {
        method: "POST",
      });
      const data = (await response.json()) as InsightBundle & {
        error?: string;
        errorCode?: string;
      };
      if (!response.ok) {
        setError(resolveRefreshErrorMessage(t, data.errorCode));
        if (data.insight) {
          setInsight(data.insight);
        }
        if (data.display) {
          setDisplay(data.display);
        }
        return;
      }
      setInsight(data.insight);
      setDisplay(data.display);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("customers.aiInsight.refreshFailed"));
    } finally {
      setRefreshing(false);
    }
  }

  const intentLevelKey = insight?.intentLevel ?? "unknown";
  const intentLabel =
    t(`customers.aiInsight.intentLevels.${intentLevelKey}`) ===
    `customers.aiInsight.intentLevels.${intentLevelKey}`
      ? intentLevelKey
      : t(`customers.aiInsight.intentLevels.${intentLevelKey}`);

  const refreshDisabledHint =
    display.refreshDisabledReason === "admin_only"
      ? t("customers.aiInsight.refreshAdminOnly")
      : display.refreshDisabledReason === "staff_disabled"
        ? t("customers.aiInsight.refreshStaffDisabled")
        : null;

  const showFailedBanner = insight?.status === "failed";
  const isFailedPlaceholder =
    insight?.status === "failed" &&
    insight.customerSummary === "AI 分析失败" &&
    insight.intentScore === 0;
  const showInsightContent =
    insight &&
    (insight.status === "ready" || (insight.status === "failed" && !isFailedPlaceholder));

  return (
    <Card className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[#172033]">{t("customers.aiInsight.title")}</h3>
          <p className="mt-1 text-xs text-[#6B7890]">{t("customers.aiInsight.disclaimer")}</p>
        </div>
        {!restricted && display.canRefresh && (
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={loading || refreshing}
            className="rounded-md border border-[#C5DAF0] bg-[#E8F1FA] px-3 py-1.5 text-sm font-medium text-[#1F4E79] hover:bg-[#DCEAF7] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refreshing ? t("customers.aiInsight.refreshing") : t("customers.aiInsight.refresh")}
          </button>
        )}
      </div>

      {!restricted && !display.canRefresh && refreshDisabledHint && (
        <p className="mt-3 text-sm text-amber-700">{refreshDisabledHint}</p>
      )}

      {loading && (
        <p className="mt-4 text-sm text-[#6B7890]">{t("customers.aiInsight.loading")}</p>
      )}

      {!loading && restricted && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">{t("customers.aiInsight.restricted")}</p>
        </div>
      )}

      {!loading && !restricted && error && (
        <p className="mt-4 text-sm text-red-600">{error}</p>
      )}

      {!loading && !restricted && !error && !insight && (
        <div className="surface-muted mt-4 p-4 text-center">
          <p className="text-sm text-[#6B7890]">{t("customers.aiInsight.empty")}</p>
        </div>
      )}

      {!loading && !restricted && showFailedBanner && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{t("customers.aiInsight.analysisFailed")}</p>
        </div>
      )}

      {!loading && !restricted && showInsightContent && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <p className="text-xs font-medium text-[#6B7890]">{t("customers.aiInsight.intentLevel")}</p>
              <span
                className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${INTENT_BADGE_CLASS[insight.intentLevel] ?? INTENT_BADGE_CLASS.unknown}`}
              >
                {intentLabel}
              </span>
            </div>
            <div>
              <p className="text-xs font-medium text-[#6B7890]">{t("customers.aiInsight.intentScore")}</p>
              <p className="mt-1 text-lg font-semibold text-[#172033]">{insight.intentScore}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-[#6B7890]">{t("customers.aiInsight.confidence")}</p>
              <p className="mt-1 text-sm text-[#172033]">{Math.round(insight.confidence * 100)}%</p>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[#6B7890]">
              {t("customers.aiInsight.customerSummary")}
            </h4>
            <p className="mt-2 text-sm text-[#172033]">{insight.customerSummary}</p>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[#6B7890]">
              {t("customers.aiInsight.currentSituation")}
            </h4>
            <p className="mt-2 text-sm text-[#172033]">{insight.currentSituation}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <SignalList
              title={t("customers.aiInsight.keySignals")}
              items={insight.keySignals}
              emptyText={t("customers.aiInsight.noKeySignals")}
              variant="positive"
            />
            <SignalList
              title={t("customers.aiInsight.riskFlags")}
              items={insight.riskFlags}
              emptyText={t("customers.aiInsight.noRiskFlags")}
              variant="risk"
            />
            <SignalList
              title={t("customers.aiInsight.missingInformation")}
              items={insight.missingInformation}
              emptyText={t("customers.aiInsight.noMissingInformation")}
              variant="missing"
            />
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[#6B7890]">
              {t("customers.aiInsight.nextBestAction")}
            </h4>
            <p className="mt-2 text-sm text-[#172033]">{insight.nextBestAction}</p>
          </div>

          {insight.suggestedFollowUpAt && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[#6B7890]">
                {t("customers.aiInsight.suggestedFollowUpAt")}
              </h4>
              <p className="mt-2 text-sm text-[#172033]">
                {formatDateTime(insight.suggestedFollowUpAt)}
              </p>
            </div>
          )}

          {display.showDraftMessage && (
            <div className="rounded-lg border border-[#C5DAF0] bg-[#E8F1FA] p-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[#1F4E79]">
                {t("customers.aiInsight.suggestedEmployeeMessage")}
              </h4>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[#172033]">
                {insight.suggestedEmployeeMessage}
              </p>
            </div>
          )}

          <p className="text-xs text-[#6B7890]">
            {t("customers.aiInsight.generatedAt", {
              time: formatDateTime(insight.generatedAt) ?? insight.generatedAt,
            })}
          </p>
        </div>
      )}
    </Card>
  );
}
