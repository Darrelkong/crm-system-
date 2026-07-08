"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslation } from "@/i18n/provider";
import type { AiInsightFeedbackStatsResponse } from "@/lib/ai/customer-insights/feedback-stats";
import type { AiInsightFeedbackReasonTag } from "../../../drizzle/schema/ai-insight-feedback";
import { formatHongKongDateTime } from "@/lib/timezone";

type StatsResponse = AiInsightFeedbackStatsResponse & {
  error?: string;
};

const RATING_KEYS = ["1", "2", "3", "4", "5"] as const;

function StatsTable({
  headers,
  rows,
  emptyLabel,
}: {
  headers: string[];
  rows: Array<Array<string | number | null | ReactNode>>;
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-[#6B7890]">{emptyLabel}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-[#E3E8F0] text-left text-[#6B7890]">
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-[#EEF2F7] text-[#172033]">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2">
                  {cell ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AiInsightFeedbackStatsPanel() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<AiInsightFeedbackStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/ai-insight-feedback/stats");
      const data = (await response.json()) as StatsResponse;
      if (!response.ok) {
        throw new Error(data.error ?? t("aiFeedbackStats.loadFailed"));
      }
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("aiFeedbackStats.loadFailed"));
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  function reasonTagLabel(tag: AiInsightFeedbackReasonTag): string {
    const key = `customers.aiInsightFeedback.reasonTags.${tag}`;
    const label = t(key);
    return label === key ? tag : label;
  }

  return (
    <div className="surface-card mt-8 p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-[#172033]">{t("aiFeedbackStats.title")}</h2>
        <p className="mt-1 text-sm text-[#6B7890]">{t("aiFeedbackStats.description")}</p>
      </div>

      {loading && (
        <p className="text-sm text-[#6B7890]">{t("aiFeedbackStats.loading")}</p>
      )}

      {!loading && error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {!loading && !error && stats && stats.summary.totalCount === 0 && (
        <p className="text-sm text-[#6B7890]">{t("aiFeedbackStats.empty")}</p>
      )}

      {!loading && !error && stats && stats.summary.totalCount > 0 && (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { label: t("aiFeedbackStats.totalCount"), value: stats.summary.totalCount },
              {
                label: t("aiFeedbackStats.averageRating"),
                value:
                  stats.summary.averageRating == null
                    ? "—"
                    : stats.summary.averageRating.toFixed(1),
              },
              { label: t("aiFeedbackStats.helpful"), value: stats.summary.helpfulCount },
              { label: t("aiFeedbackStats.neutral"), value: stats.summary.neutralCount },
              { label: t("aiFeedbackStats.notHelpful"), value: stats.summary.notHelpfulCount },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-lg border border-[#E3E8F0] bg-[#F7FAFD] px-4 py-3"
              >
                <p className="text-xs font-medium text-[#6B7890]">{card.label}</p>
                <p className="mt-1 text-xl font-semibold text-[#172033]">{card.value}</p>
              </div>
            ))}
          </div>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-[#172033]">
              {t("aiFeedbackStats.ratingDistribution")}
            </h3>
            <StatsTable
              headers={[t("aiFeedbackStats.rating"), t("aiFeedbackStats.count")]}
              rows={RATING_KEYS.map((rating) => [
                `${rating} ★`,
                stats.summary.ratingDistribution[rating],
              ])}
              emptyLabel={t("aiFeedbackStats.empty")}
            />
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-[#172033]">
              {t("aiFeedbackStats.reasonTagRankings")}
            </h3>
            <StatsTable
              headers={[t("aiFeedbackStats.reasonTag"), t("aiFeedbackStats.count")]}
              rows={stats.reasonTagRankings.map((row) => [
                reasonTagLabel(row.tag),
                row.count,
              ])}
              emptyLabel={t("aiFeedbackStats.noReasonTags")}
            />
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-[#172033]">
              {t("aiFeedbackStats.byModel")}
            </h3>
            <StatsTable
              headers={[
                t("aiFeedbackStats.model"),
                t("aiFeedbackStats.count"),
                t("aiFeedbackStats.averageRating"),
              ]}
              rows={stats.byModel.map((row) => [
                row.model,
                row.count,
                row.averageRating.toFixed(1),
              ])}
              emptyLabel={t("aiFeedbackStats.empty")}
            />
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-[#172033]">
              {t("aiFeedbackStats.byPromptVersion")}
            </h3>
            <StatsTable
              headers={[
                t("aiFeedbackStats.promptVersion"),
                t("aiFeedbackStats.count"),
                t("aiFeedbackStats.averageRating"),
              ]}
              rows={stats.byPromptVersion.map((row) => [
                row.promptVersion,
                row.count,
                row.averageRating.toFixed(1),
              ])}
              emptyLabel={t("aiFeedbackStats.empty")}
            />
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-[#172033]">
              {t("aiFeedbackStats.recent")}
            </h3>
            <StatsTable
              headers={[
                t("aiFeedbackStats.customer"),
                t("aiFeedbackStats.rating"),
                t("aiFeedbackStats.model"),
                t("aiFeedbackStats.promptVersion"),
                t("aiFeedbackStats.commentLength"),
                t("aiFeedbackStats.updatedAt"),
              ]}
              rows={stats.recent.map((row) => [
                row.customerName ? (
                  <Link
                    href={`/customers/${row.customerId}`}
                    className="text-[#2F6FB3] hover:underline"
                  >
                    {row.customerName}
                  </Link>
                ) : (
                  row.customerId
                ),
                row.rating,
                row.model,
                row.promptVersion,
                row.commentLength,
                formatHongKongDateTime(row.updatedAt, row.updatedAt),
              ])}
              emptyLabel={t("aiFeedbackStats.empty")}
            />
          </section>
        </div>
      )}
    </div>
  );
}
