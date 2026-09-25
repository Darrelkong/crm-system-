"use client";

import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import type { KnowledgeCategoryListItem } from "@/lib/knowledge/core-service";
import type { KnowledgeSegmentCandidateDetail } from "@/lib/knowledge/knowledge-segment-candidate-service";
import { KnowledgeSegmentCandidateCard } from "@/components/knowledge/knowledge-segment-candidate-card";

const PREVIEW_MAX_LINES = 3;
const PREVIEW_MAX_CHARS = 240;

export function evidencePreviewForCandidate(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const compact = lines.slice(0, PREVIEW_MAX_LINES).join("\n");
  if (compact.length <= PREVIEW_MAX_CHARS) return compact;
  return `${compact.slice(0, PREVIEW_MAX_CHARS)}…`;
}

export function KnowledgeSegmentCandidateCards({
  sourceId,
  candidates,
  categories,
  locale,
  loading,
  error,
  countMismatch,
  onRetry,
  onCandidateUpdated,
}: {
  sourceId: string;
  candidates: KnowledgeSegmentCandidateDetail[];
  categories: KnowledgeCategoryListItem[];
  locale: "zh-Hans" | "zh-Hant" | "en";
  loading: boolean;
  error: string | null;
  countMismatch: boolean;
  onRetry: () => void;
  onCandidateUpdated: () => void;
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div
        className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm crm-text-secondary"
        data-candidate-cards-loading="true"
      >
        {t("knowledge.ingest.smartIngestCandidatesPreparing")}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
        data-candidate-cards-error="true"
      >
        <p>{error}</p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="mt-3"
          data-candidate-cards-retry="true"
          onClick={onRetry}
        >
          {t("knowledge.ingest.smartIngestCandidatesRetry")}
        </Button>
      </div>
    );
  }

  if (candidates.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 space-y-3" data-candidate-cards-section="true">
      <div className="space-y-1">
        <p className="text-sm font-semibold crm-text">
          {t("knowledge.ingest.smartIngestCandidatesSectionTitle")}
        </p>
        <p className="text-sm crm-text-secondary">
          {t("knowledge.ingest.smartIngestCandidatesContinuation", {
            count: String(candidates.length),
          })}
        </p>
        <p className="text-xs crm-text-secondary">
          {t("knowledge.ingest.smartIngestCandidatesGeneratedCount", {
            count: String(candidates.length),
          })}
        </p>
      </div>
      {countMismatch ? (
        <p
          className="text-xs text-amber-800"
          data-candidate-count-mismatch="true"
        >
          {t("knowledge.ingest.smartIngestCandidatesCountMismatch")}
        </p>
      ) : null}
      <ul className="space-y-3">
        {candidates.map((candidate) => (
          <li key={candidate.id}>
            <KnowledgeSegmentCandidateCard
              sourceId={sourceId}
              candidate={candidate}
              categories={categories}
              locale={locale}
              onUpdated={onCandidateUpdated}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
