"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { KnowledgeIngestStepHeader } from "@/components/knowledge/knowledge-ingest-step-header";
import type { KnowledgeSegmentCandidateDetail } from "@/lib/knowledge/knowledge-segment-candidate-service";
import type { KnowledgeComparisonDetail } from "@/lib/knowledge/comparison-types";
import type { OrganizerDraftFields } from "@/lib/knowledge/knowledge-ingest-organizer-draft";
import { isUsableCandidateOrganizerDraft } from "@/lib/knowledge/knowledge-candidate-organizer-draft-usability";
import {
  comparisonMatchesOrganizerDraft,
  normalizeComparedOrganizerDraft,
} from "@/lib/knowledge/knowledge-candidate-comparison-draft";
import { resolveKnowledgeApiError } from "@/lib/knowledge/error-messages";

type CandidateDraftState = {
  title: string;
  summary: string;
  body: string;
  organized: boolean;
};

export function KnowledgeSmartIngestCandidateWorkflow({
  sourceId,
  candidates,
  draftByCandidateId,
}: {
  sourceId: string;
  candidates: KnowledgeSegmentCandidateDetail[];
  draftByCandidateId: Record<string, CandidateDraftState>;
}) {
  const { t } = useTranslation();
  const [comparisons, setComparisons] = useState<
    Record<string, KnowledgeComparisonDetail | null>
  >({});
  const [comparingId, setComparingId] = useState<string | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedArticleIds, setSavedArticleIds] = useState<Record<string, string>>(
    {},
  );

  const activeCandidates = useMemo(
    () => candidates.filter((candidate) => candidate.status !== "superseded"),
    [candidates],
  );

  const loadComparison = useCallback(
    async (candidateId: string) => {
      const response = await fetch(
        `/api/knowledge/sources/${sourceId}/candidates/${candidateId}/comparison`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        comparison?: KnowledgeComparisonDetail | null;
      };
      if (response.ok) {
        setComparisons((current) => ({
          ...current,
          [candidateId]: payload.comparison ?? null,
        }));
      }
    },
    [sourceId],
  );

  useEffect(() => {
    for (const candidate of activeCandidates) {
      void loadComparison(candidate.id);
      if (candidate.draftArticleId) {
        setSavedArticleIds((current) => ({
          ...current,
          [candidate.id]: candidate.draftArticleId!,
        }));
      }
    }
  }, [activeCandidates, loadComparison]);

  const organizedCount = activeCandidates.filter((candidate) => {
    const draft = draftByCandidateId[candidate.id];
    return draft?.organized;
  }).length;

  const comparedCount = activeCandidates.filter((candidate) => {
    const draft = draftByCandidateId[candidate.id];
    const comparison = comparisons[candidate.id];
    return (
      draft?.organized &&
      comparison?.status === "completed" &&
      comparison.comparison &&
      comparisonMatchesOrganizerDraft(
        comparison.comparison,
        normalizeComparedOrganizerDraft({
          title: draft.title,
          summary: draft.summary,
          body: draft.body,
        }),
      )
    );
  }).length;

  const savedCount = activeCandidates.filter(
    (candidate) => savedArticleIds[candidate.id] || candidate.draftArticleId,
  ).length;

  async function runCompare(candidateId: string) {
    const draft = draftByCandidateId[candidateId];
    if (!draft?.organized) return;
    setComparingId(candidateId);
    setErrors((current) => ({ ...current, [candidateId]: "" }));
    try {
      const response = await fetch(
        `/api/knowledge/sources/${sourceId}/candidates/${candidateId}/compare`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: draft.title,
            summary: draft.summary,
            body: draft.body,
          }),
        },
      );
      const payload = (await response.json()) as {
        comparison?: KnowledgeComparisonDetail;
        error?: string;
        errorCode?: string;
      };
      if (!response.ok || !payload.comparison) {
        throw new Error(
          resolveKnowledgeApiError(
            t,
            payload,
            "knowledge.ingest.smartIngestCandidateCompareFailed",
          ),
        );
      }
      setComparisons((current) => ({
        ...current,
        [candidateId]: payload.comparison!,
      }));
    } catch (caught) {
      setErrors((current) => ({
        ...current,
        [candidateId]:
          caught instanceof Error
            ? caught.message
            : t("knowledge.ingest.smartIngestCandidateCompareFailed"),
      }));
    } finally {
      setComparingId(null);
    }
  }

  async function runConvert(candidate: KnowledgeSegmentCandidateDetail) {
    const draft = draftByCandidateId[candidate.id];
    if (!draft?.organized || !candidate.knowledgeCategoryId) return;
    setConvertingId(candidate.id);
    setErrors((current) => ({ ...current, [candidate.id]: "" }));
    try {
      const response = await fetch(
        `/api/knowledge/sources/${sourceId}/candidates/${candidate.id}/convert`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: draft.title,
            summary: draft.summary,
            body: draft.body,
            categoryId: candidate.knowledgeCategoryId,
          }),
        },
      );
      const payload = (await response.json()) as {
        article?: { id: string };
        error?: string;
        errorCode?: string;
      };
      if (!response.ok || !payload.article) {
        throw new Error(
          resolveKnowledgeApiError(
            t,
            payload,
            "knowledge.ingest.smartIngestCandidateConvertFailed",
          ),
        );
      }
      setSavedArticleIds((current) => ({
        ...current,
        [candidate.id]: payload.article!.id,
      }));
    } catch (caught) {
      setErrors((current) => ({
        ...current,
        [candidate.id]:
          caught instanceof Error
            ? caught.message
            : t("knowledge.ingest.smartIngestCandidateConvertFailed"),
      }));
    } finally {
      setConvertingId(null);
    }
  }

  if (activeCandidates.length === 0) return null;

  return (
    <div className="mt-4 space-y-4" data-smart-ingest-candidate-workflow="true">
      <p className="text-sm crm-text-secondary" data-candidate-workflow-progress="true">
        {t("knowledge.ingest.smartIngestCandidateWorkflowProgress", {
          organized: String(organizedCount),
          compared: String(comparedCount),
          saved: String(savedCount),
          total: String(activeCandidates.length),
        })}
      </p>

      <Card className="p-4" data-ingest-step="candidate-compare">
        <KnowledgeIngestStepHeader
          step={4}
          title={t("knowledge.ingest.smartIngestStepCompare")}
        />
        <ul className="mt-4 space-y-3">
          {activeCandidates.map((candidate) => {
            const draft = draftByCandidateId[candidate.id];
            const organized = Boolean(draft?.organized);
            const comparison = comparisons[candidate.id];
            const draftSnapshot = draft
              ? normalizeComparedOrganizerDraft(draft)
              : null;
            const comparisonFresh =
              comparison?.status === "completed" &&
              comparison.comparison &&
              draftSnapshot &&
              comparisonMatchesOrganizerDraft(
                comparison.comparison,
                draftSnapshot,
              );
            const stale =
              comparison?.status === "completed" &&
              draftSnapshot &&
              comparison.comparison &&
              !comparisonMatchesOrganizerDraft(
                comparison.comparison,
                draftSnapshot,
              );
            return (
              <li
                key={candidate.id}
                className="rounded-xl border border-slate-200 bg-white p-3"
                data-candidate-compare-row={candidate.id}
              >
                <p className="text-sm font-medium crm-text">
                  {t("knowledge.ingest.segmentNumber", {
                    index: String(candidate.segmentIndex + 1),
                  })}
                  {" · "}
                  {candidate.segmentTitleHint}
                </p>
                {!organized ? (
                  <p className="mt-2 text-xs crm-text-secondary">
                    {t("knowledge.ingest.smartIngestCandidateCompareAwaitOrganize")}
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={comparingId === candidate.id}
                      data-candidate-compare-button="true"
                      onClick={() => void runCompare(candidate.id)}
                    >
                      {comparingId === candidate.id
                        ? t("knowledge.ingest.smartIngestCandidateComparing")
                        : stale
                          ? t("knowledge.ingest.smartIngestCandidateCompareAgain")
                          : t("knowledge.ingest.smartIngestCandidateCompare")}
                    </Button>
                    {comparisonFresh ? (
                      <span className="text-xs font-medium text-emerald-700">
                        {t("knowledge.ingest.smartIngestCandidateCompareDone")}
                      </span>
                    ) : null}
                    {stale ? (
                      <span className="text-xs text-amber-800">
                        {t("knowledge.ingest.smartIngestCandidateCompareStale")}
                      </span>
                    ) : null}
                  </div>
                )}
                {errors[candidate.id] ? (
                  <p className="mt-2 text-sm text-rose-700">{errors[candidate.id]}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="p-4" data-ingest-step="candidate-draft">
        <KnowledgeIngestStepHeader
          step={5}
          title={t("knowledge.ingest.smartIngestStepSaveDrafts")}
        />
        <ul className="mt-4 space-y-3">
          {activeCandidates.map((candidate) => {
            const draft = draftByCandidateId[candidate.id];
            const organized = Boolean(draft?.organized);
            const comparison = comparisons[candidate.id];
            const draftSnapshot = draft
              ? normalizeComparedOrganizerDraft(draft)
              : null;
            const comparisonFresh =
              comparison?.status === "completed" &&
              comparison.comparison &&
              draftSnapshot &&
              comparisonMatchesOrganizerDraft(
                comparison.comparison,
                draftSnapshot,
              );
            const savedId =
              savedArticleIds[candidate.id] ?? candidate.draftArticleId;
            const canConvert =
              organized &&
              comparisonFresh &&
              Boolean(candidate.knowledgeCategoryId) &&
              !savedId;
            return (
              <li
                key={candidate.id}
                className="rounded-xl border border-slate-200 bg-white p-3"
                data-candidate-convert-row={candidate.id}
              >
                <p className="text-sm font-medium crm-text">
                  {candidate.segmentTitleHint}
                </p>
                <p className="mt-1 text-xs crm-text-secondary">
                  {candidate.knowledgeCategoryId
                    ? t("knowledge.ingest.smartIngestCandidateCategoryReady")
                    : t("knowledge.ingest.smartIngestCandidateCategoryRequired")}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {savedId ? (
                    <>
                      <span className="text-xs font-medium text-emerald-700">
                        {t("knowledge.ingest.smartIngestCandidateSavedAsDraft")}
                      </span>
                      <Link
                        href={`/knowledge/articles/${savedId}`}
                        className="text-xs font-medium text-blue-700 underline"
                      >
                        {t("knowledge.ingest.smartIngestCandidateOpenDraft")}
                      </Link>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      disabled={!canConvert || convertingId === candidate.id}
                      data-candidate-convert-button="true"
                      onClick={() => void runConvert(candidate)}
                    >
                      {convertingId === candidate.id
                        ? t("knowledge.ingest.smartIngestCandidateSaving")
                        : t("knowledge.ingest.smartIngestCandidateSaveDraft")}
                    </Button>
                  )}
                </div>
                {!savedId && !candidate.knowledgeCategoryId ? (
                  <p className="mt-1 text-xs crm-text-secondary">
                    {t("knowledge.ingest.smartIngestCandidateCategoryRequired")}
                  </p>
                ) : null}
                {!savedId && organized && !comparisonFresh ? (
                  <p className="mt-1 text-xs crm-text-secondary">
                    {t("knowledge.ingest.smartIngestCandidateCompareRequired")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
        {savedCount === activeCandidates.length && activeCandidates.length > 0 ? (
          <p className="mt-4 text-sm font-medium text-emerald-800">
            {t("knowledge.ingest.smartIngestCandidateAllSaved")}
          </p>
        ) : null}
      </Card>
    </div>
  );
}

export type { CandidateDraftState };
