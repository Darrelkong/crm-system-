"use client";

import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { KnowledgeSegmentCandidateDetail } from "@/lib/knowledge/knowledge-segment-candidate-service";

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

function candidateStatusLabelKey(
  status: KnowledgeSegmentCandidateDetail["status"],
): string {
  if (status === "ready") {
    return "knowledge.ingest.smartIngestCandidateReady";
  }
  return "knowledge.ingest.smartIngestCandidatePending";
}

export function KnowledgeSegmentCandidateCards({
  candidates,
  loading,
  error,
  countMismatch,
  onRetry,
}: {
  candidates: KnowledgeSegmentCandidateDetail[];
  loading: boolean;
  error: string | null;
  countMismatch: boolean;
  onRetry: () => void;
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
            <Card
              className={cn("p-4", "border-slate-200 bg-white")}
              data-candidate-card="true"
              data-candidate-id={candidate.id}
              data-candidate-segment-index={String(candidate.segmentIndex)}
            >
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {t("knowledge.ingest.segmentNumber", {
                  index: String(candidate.segmentIndex + 1),
                })}
              </p>
              <p className="mt-1 text-base font-semibold crm-text">
                {candidate.segmentTitleHint}
              </p>
              <p
                className="mt-2 text-xs font-medium text-slate-600"
                data-candidate-status-label="true"
              >
                {t(candidateStatusLabelKey(candidate.status))}
              </p>
              <p className="mt-3 text-xs font-medium crm-text-secondary">
                {t("knowledge.ingest.smartIngestCandidateEvidencePreview")}
              </p>
              <pre
                className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 crm-text"
                data-candidate-evidence-preview="true"
              >
                {evidencePreviewForCandidate(candidate.segmentEvidenceText)}
              </pre>
              <p className="mt-3 text-xs crm-text-secondary">
                {t("knowledge.ingest.smartIngestCandidateSeparateArticleHint")}
              </p>
              <p
                className="mt-2 text-xs text-slate-500"
                data-candidate-next-step="true"
              >
                {t("knowledge.ingest.smartIngestCandidateNextStep")}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
