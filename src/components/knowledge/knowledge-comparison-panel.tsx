"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Info, Loader2 } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { KnowledgeComparisonDetail } from "@/lib/knowledge/comparison-types";
import type {
  KnowledgeComparisonDiffItem,
  KnowledgeComparisonSuggestedUpdate,
} from "@/lib/knowledge/ai-comparison-schema";
import {
  buildArticleHistoryHref,
  countComparisonDiffGroups,
  formatMatchConfidencePercent,
  resolveComparisonConfidenceTone,
  resolveMatchedArticleTitle,
  shouldExpandComparisonGroupByDefault,
} from "@/lib/knowledge/knowledge-comparison-orchestration";

type ComparisonPanelProps = {
  sourceId: string | null;
  comparison: KnowledgeComparisonDetail | null;
  loading: boolean;
  comparing: boolean;
  processing: boolean;
  timedOut?: boolean;
  error: string | null;
  canExecute: boolean;
  canView: boolean;
  onCompare?: () => void;
  onRetry?: () => void;
  onCreateDraft?: () => void;
  className?: string;
};

function ConfidenceBadge({
  confidence,
}: {
  confidence: number | null | undefined;
}) {
  const { t } = useTranslation();
  const percent = formatMatchConfidencePercent(confidence);
  if (!percent) return null;
  const tone = resolveComparisonConfidenceTone(confidence);
  const toneClass =
    tone === "high"
      ? "border-indigo-200 bg-indigo-50 text-indigo-900"
      : tone === "medium"
        ? "border-slate-200 bg-slate-50 text-slate-800"
        : "border-amber-200 bg-amber-50 text-amber-950";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        toneClass,
      )}
    >
      {t("knowledge.comparison.matchConfidence", { percent })}
    </span>
  );
}

function ExcerptQuote({ text }: { text: string | null | undefined }) {
  if (!text?.trim()) return null;
  return (
    <p className="mt-1 text-xs leading-5 text-slate-500">
      “{text.trim()}”
    </p>
  );
}

function DiffItemCard({
  item,
  showExisting,
}: {
  item: KnowledgeComparisonDiffItem;
  showExisting: boolean;
}) {
  const { t } = useTranslation();
  const judgmentPercent = formatMatchConfidencePercent(item.confidence);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-sm font-medium crm-text">{item.topic}</p>
      {showExisting && item.existingValue && (
        <div className="mt-3">
          <p className="text-xs font-medium text-slate-500">
            {t("knowledge.comparison.existingKnowledge")}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm crm-text">
            {item.existingValue}
          </p>
          <ExcerptQuote text={item.existingExcerpt} />
        </div>
      )}
      {item.incomingValue && (
        <div className={cn("mt-3", !showExisting && "mt-2")}>
          <p className="text-xs font-medium text-slate-500">
            {t("knowledge.comparison.incomingMaterial")}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm crm-text">
            {item.incomingValue}
          </p>
          <ExcerptQuote text={item.sourceExcerpt} />
        </div>
      )}
      <div className="mt-3 rounded-lg bg-slate-50 p-3">
        <p className="text-xs font-medium text-slate-500">
          {t("knowledge.comparison.aiJudgment")}
        </p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm crm-text-secondary">
          {item.explanation}
        </p>
        {judgmentPercent && (
          <p className="mt-2 text-xs text-slate-500">
            {t("knowledge.comparison.itemConfidence", {
              percent: judgmentPercent,
            })}
          </p>
        )}
      </div>
    </div>
  );
}

function ComparisonAccordion({
  title,
  count,
  tone,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  tone: "cyan" | "indigo" | "rose" | "amber" | "slate";
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toneClass =
    tone === "cyan"
      ? "border-cyan-100 bg-cyan-50/70"
      : tone === "indigo"
        ? "border-indigo-100 bg-indigo-50/70"
        : tone === "rose"
          ? "border-rose-100 bg-rose-50/70"
          : tone === "amber"
            ? "border-amber-100 bg-amber-50/70"
            : "border-slate-200 bg-slate-50";
  if (count === 0) return null;
  return (
    <div className={cn("rounded-xl border", toneClass)}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="text-sm font-medium crm-text">
          {title}
          <span className="ml-2 text-slate-500">{count}</span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-slate-500 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <div className="space-y-3 px-3 pb-3">{children}</div>}
    </div>
  );
}

function SuggestedUpdateCard({ item }: { item: KnowledgeComparisonSuggestedUpdate }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-sm font-medium crm-text">{item.topic}</p>
      <p className="mt-2 text-xs font-medium text-slate-500">
        {t("knowledge.comparison.suggestionLabel")}
      </p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm crm-text">
        {item.suggestion}
      </p>
      <p className="mt-3 text-xs font-medium text-slate-500">
        {t("knowledge.comparison.rationaleLabel")}
      </p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm crm-text-secondary">
        {item.rationale}
      </p>
    </div>
  );
}

function SummaryCounts({
  counts,
}: {
  counts: ReturnType<typeof countComparisonDiffGroups>;
}) {
  const { t } = useTranslation();
  const items = [
    {
      key: "newFacts",
      label: t("knowledge.comparison.countNewFacts"),
      value: counts.newFacts,
      className: "border-cyan-100 bg-cyan-50/60",
    },
    {
      key: "changedFacts",
      label: t("knowledge.comparison.countChangedFacts"),
      value: counts.changedFacts,
      className: "border-indigo-100 bg-indigo-50/60",
    },
    {
      key: "conflicts",
      label: t("knowledge.comparison.countConflicts"),
      value: counts.conflicts,
      className: "border-rose-100 bg-rose-50/60",
    },
    {
      key: "uncertainties",
      label: t("knowledge.comparison.countUncertainties"),
      value: counts.uncertainties,
      className: "border-amber-100 bg-amber-50/60",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.key}
          className={cn("rounded-xl border px-3 py-2.5", item.className)}
        >
          <p className="text-xs crm-text-secondary">{item.label}</p>
          <p className="mt-1 text-lg font-semibold crm-text">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

export function KnowledgeComparisonPanel({
  sourceId,
  comparison,
  loading,
  comparing,
  processing,
  timedOut = false,
  error,
  canExecute,
  canView,
  onCompare,
  onRetry,
  onCreateDraft,
  className,
}: ComparisonPanelProps) {
  const { t } = useTranslation();
  const counts = useMemo(
    () => countComparisonDiffGroups(comparison),
    [comparison],
  );

  if (!sourceId || !canView) return null;

  const relationship = comparison?.comparison?.relationship;
  const matchedTitle = comparison ? resolveMatchedArticleTitle(comparison) : null;
  const degraded = Boolean(comparison?.degradationLevel);

  if (!comparison && !loading && !comparing && !error) {
    return (
      <Card className={className} data-comparison-panel="empty">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm crm-text-secondary">
            {canExecute
              ? t("knowledge.comparison.noResultYetExecutable")
              : t("knowledge.comparison.noResultYetReadOnly")}
          </p>
          {canExecute && onCompare && (
            <Button type="button" size="sm" onClick={onCompare} disabled={processing}>
              {t("knowledge.comparison.compareAction")}
            </Button>
          )}
        </div>
      </Card>
    );
  }

  if (
    timedOut ||
    (comparison?.status === "failed" && !processing)
  ) {
    return (
      <Card className={className} data-comparison-panel="failed">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-950">
            {t("knowledge.comparison.failedTitle")}
          </p>
          <p className="mt-2 text-sm text-amber-900">
            {error ?? t("knowledge.comparison.failedMessage")}
          </p>
          {canExecute && onRetry && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="mt-4"
              onClick={onRetry}
              disabled={processing}
            >
              {t("knowledge.comparison.retryAction")}
            </Button>
          )}
        </div>
      </Card>
    );
  }

  if (processing && (!comparison || comparison.status !== "completed")) {
    return (
      <Card className={className} data-comparison-panel="loading">
        <div className="flex items-center gap-3 text-sm crm-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>{t("knowledge.comparison.comparing")}</span>
        </div>
      </Card>
    );
  }

  if (!comparison || comparison.status !== "completed") {
    return null;
  }

  const renderActions = () => {
    if (relationship === "update_existing" && comparison.matchedArticleId) {
      return (
        <div className="flex flex-wrap gap-2">
          <Link
            href={buildArticleHistoryHref(
              comparison.matchedArticleId,
              comparison.matchedVersionNumber,
            )}
            className="primary-button inline-flex min-h-9 items-center rounded-xl px-3 py-2 text-sm"
          >
            {t("knowledge.comparison.viewExistingKnowledge")}
          </Link>
          {onCreateDraft && (
            <Button type="button" size="sm" variant="secondary" onClick={onCreateDraft}>
              {t("knowledge.comparison.createArticleAction")}
            </Button>
          )}
        </div>
      );
    }
    if (
      relationship === "new_article" ||
      relationship === "no_match"
    ) {
      return onCreateDraft ? (
        <Button type="button" size="sm" onClick={onCreateDraft}>
          {t("knowledge.comparison.createArticleAction")}
        </Button>
      ) : null;
    }
    if (relationship === "ambiguous") {
      return (
        <p className="text-sm crm-text-secondary">
          {t("knowledge.comparison.ambiguousGuidance")}
        </p>
      );
    }
    return null;
  };

  return (
    <Card className={className} data-comparison-panel="completed">
      <div className="space-y-4">
        {relationship === "update_existing" && comparison.matchedArticleId && (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
              {t("knowledge.comparison.matchedHeader")}
            </p>
            <p className="mt-2 text-base font-semibold crm-text">
              {matchedTitle ?? t("knowledge.comparison.matchedArticleFallback")}
            </p>
            {comparison.matchedVersionNumber != null && (
              <p className="mt-1 text-sm crm-text-secondary">
                {t("knowledge.article.publishedVersionBadge", {
                  version: String(comparison.matchedVersionNumber),
                })}
              </p>
            )}
            <div className="mt-3">
              <ConfidenceBadge confidence={comparison.matchConfidence} />
            </div>
          </div>
        )}

        {relationship === "new_article" && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium crm-text">
              {t("knowledge.comparison.newArticleTitle")}
            </p>
            <p className="mt-2 text-sm crm-text-secondary">
              {t("knowledge.comparison.newArticleBody")}
            </p>
          </div>
        )}

        {relationship === "no_match" && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium crm-text">
              {t("knowledge.comparison.noMatchTitle")}
            </p>
            <p className="mt-2 text-sm crm-text-secondary">
              {t("knowledge.comparison.noMatchBody")}
            </p>
          </div>
        )}

        {relationship === "ambiguous" && (
          <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-4">
            <p className="text-sm font-medium crm-text">
              {t("knowledge.comparison.ambiguousTitle")}
            </p>
            <p className="mt-2 text-sm crm-text-secondary">
              {t("knowledge.comparison.ambiguousBody")}
            </p>
            {comparison.candidateSnapshot.length > 0 && (
              <ul className="mt-4 space-y-2">
                {comparison.candidateSnapshot.map((candidate) => (
                  <li
                    key={candidate.articleVersionId}
                    className="rounded-lg border border-white/80 bg-white/80 p-3"
                  >
                    <p className="text-sm font-medium crm-text">{candidate.title}</p>
                    <p className="mt-1 text-xs crm-text-secondary">
                      {t("knowledge.article.publishedVersionBadge", {
                        version: String(candidate.versionNumber),
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {degraded && (
          <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">{t("knowledge.comparison.degradedBadge")}</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                {t("knowledge.comparison.degradedHint")}
              </p>
            </div>
          </div>
        )}

        {(counts.newFacts > 0 ||
          counts.changedFacts > 0 ||
          counts.conflicts > 0 ||
          counts.uncertainties > 0) && (
          <>
            <SummaryCounts counts={counts} />
            <div className="space-y-2">
              <ComparisonAccordion
                title={t("knowledge.comparison.groupNewFacts")}
                count={counts.newFacts}
                tone="cyan"
                defaultOpen={shouldExpandComparisonGroupByDefault(counts.newFacts)}
              >
                {comparison.comparison?.newFacts.map((item) => (
                  <DiffItemCard key={item.id} item={item} showExisting={false} />
                ))}
              </ComparisonAccordion>
              <ComparisonAccordion
                title={t("knowledge.comparison.groupChangedFacts")}
                count={counts.changedFacts}
                tone="indigo"
                defaultOpen={shouldExpandComparisonGroupByDefault(
                  counts.changedFacts,
                )}
              >
                {comparison.comparison?.changedFacts.map((item) => (
                  <DiffItemCard key={item.id} item={item} showExisting={true} />
                ))}
              </ComparisonAccordion>
              <ComparisonAccordion
                title={t("knowledge.comparison.groupConflicts")}
                count={counts.conflicts}
                tone="rose"
                defaultOpen={shouldExpandComparisonGroupByDefault(counts.conflicts)}
              >
                {comparison.comparison?.conflicts.map((item) => (
                  <DiffItemCard key={item.id} item={item} showExisting={true} />
                ))}
              </ComparisonAccordion>
              <ComparisonAccordion
                title={t("knowledge.comparison.groupUncertainties")}
                count={counts.uncertainties}
                tone="amber"
                defaultOpen={shouldExpandComparisonGroupByDefault(
                  counts.uncertainties,
                )}
              >
                {comparison.comparison?.uncertainties.map((item) => (
                  <DiffItemCard key={item.id} item={item} showExisting={false} />
                ))}
              </ComparisonAccordion>
            </div>
          </>
        )}

        {counts.suggestedUpdates > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold crm-text">
                {t("knowledge.comparison.suggestedUpdatesTitle")}
              </h3>
              <Badge>{counts.suggestedUpdates}</Badge>
            </div>
            <div className="space-y-2">
              {comparison.comparison?.suggestedUpdates.map((item, index) => (
                <SuggestedUpdateCard key={`${item.topic}-${index}`} item={item} />
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          {renderActions()}
          {canExecute && onCompare && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onCompare}
              disabled={processing}
            >
              {t("knowledge.comparison.retryAction")}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
