"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";
import { KnowledgeIngestStepHeader } from "@/components/knowledge/knowledge-ingest-step-header";
import type { KnowledgeSourceDetail } from "@/lib/knowledge/source-service";
import { resolveKnowledgeApiError } from "@/lib/knowledge/error-messages";
import type { KnowledgeSourceAnalysisStatus } from "../../../drizzle/schema/knowledge-sources";
import {
  deriveSmartIngestSourceScope,
  type SmartIngestSourceScope,
} from "@/lib/knowledge/smart-ingest-source-scope";
import { KnowledgeSegmentCandidateCards } from "@/components/knowledge/knowledge-segment-candidate-cards";
import type { KnowledgeSegmentCandidateDetail } from "@/lib/knowledge/knowledge-segment-candidate-service";

type AnalysisSegment = {
  id: string;
  segmentIndex: number;
  titleHint: string;
  evidenceText: string;
  evidenceStart: number;
  evidenceEnd: number;
  status: "proposed" | "confirmed" | "rejected" | "superseded";
  createdAt: string;
};

type AnalysisRun = {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  segments: AnalysisSegment[];
  failureMessage: string | null;
};

const EXCERPT_CHARS = 280;

function scopeFromRun(
  source: KnowledgeSourceDetail,
  run: AnalysisRun | null,
): SmartIngestSourceScope {
  const segments =
    run?.segments ??
    source.smartIngestScope.segments.map((segment) => ({
      ...segment,
      createdAt: "",
    }));
  return deriveSmartIngestSourceScope({
    analysisStatus: source.analysisStatus,
    latestAnalysisRunId: run?.id ?? source.smartIngestScope.latestAnalysisRunId,
    segments,
  });
}

function initialRunFromSource(source: KnowledgeSourceDetail): AnalysisRun | null {
  if (
    source.analysisStatus !== "ready_for_review" ||
    !source.smartIngestScope.latestAnalysisRunId ||
    source.smartIngestScope.segments.length === 0
  ) {
    return null;
  }
  return {
    id: source.smartIngestScope.latestAnalysisRunId,
    status: "completed",
    failureMessage: null,
    segments: source.smartIngestScope.segments.map((segment) => ({
      ...segment,
      createdAt: "",
    })),
  };
}

export function KnowledgeSmartIngestAnalysisSection({
  source,
  onAnalysisStatusChange,
  onScopeChange,
  onAnalysisComplete,
}: {
  source: KnowledgeSourceDetail;
  onAnalysisStatusChange: (status: KnowledgeSourceAnalysisStatus) => void;
  onScopeChange?: (scope: SmartIngestSourceScope) => void;
  onAnalysisComplete?: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [analyzing, setAnalyzing] = useState(false);
  const [run, setRun] = useState<AnalysisRun | null>(() =>
    initialRunFromSource(source),
  );
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [segmentBusy, setSegmentBusy] = useState(false);
  const [candidates, setCandidates] = useState<KnowledgeSegmentCandidateDetail[]>(
    [],
  );
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [candidateCountMismatch, setCandidateCountMismatch] = useState(false);
  const materializeAttemptedRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isPaste = source.sourceType === "paste";
  const activeSegments =
    run?.segments.filter((segment) => segment.status !== "superseded") ?? [];

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  useEffect(() => {
    materializeAttemptedRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset candidate UI when analysis run changes
    setCandidates([]);
    setCandidatesError(null);
    setCandidateCountMismatch(false);
  }, [source.id, run?.id]);

  const refreshCandidates = useCallback(
    async (confirmedCount: number) => {
      if (confirmedCount === 0) {
        setCandidates([]);
        return;
      }
      setCandidatesLoading(true);
      setCandidatesError(null);
      setCandidateCountMismatch(false);
      try {
        const loadList = async () => {
          const response = await fetch(
            `/api/knowledge/sources/${source.id}/candidates`,
            { cache: "no-store" },
          );
          const payload = (await response.json()) as {
            candidates?: KnowledgeSegmentCandidateDetail[];
            error?: string;
            errorCode?: string;
          };
          if (!response.ok) {
            throw new Error(
              resolveKnowledgeApiError(
                t,
                payload,
                "knowledge.ingest.smartIngestCandidatesLoadFailed",
              ),
            );
          }
          return payload.candidates ?? [];
        };

        let list = await loadList();
        if (
          list.length < confirmedCount &&
          !materializeAttemptedRef.current
        ) {
          materializeAttemptedRef.current = true;
          const materializeResponse = await fetch(
            `/api/knowledge/sources/${source.id}/candidates`,
            { method: "POST" },
          );
          if (materializeResponse.ok) {
            list = await loadList();
          }
        }
        list.sort((a, b) => a.segmentIndex - b.segmentIndex);
        setCandidates(list);
        if (list.length !== confirmedCount) {
          setCandidateCountMismatch(true);
        }
      } catch (caught) {
        setCandidates([]);
        setCandidatesError(
          caught instanceof Error
            ? caught.message
            : t("knowledge.ingest.smartIngestCandidatesLoadFailed"),
        );
      } finally {
        setCandidatesLoading(false);
      }
    },
    [source.id, t],
  );

  const pollRun = useCallback(
    async (sourceId: string, runId: string) => {
      const response = await fetch(
        `/api/knowledge/sources/${sourceId}/analysis-runs/${runId}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        run?: AnalysisRun;
        error?: string;
        errorCode?: string;
      };
      if (!response.ok || !payload.run) {
        throw new Error(
          resolveKnowledgeApiError(t, payload, "knowledge.ingest.analysisFailed"),
        );
      }
      setRun(payload.run);
      onScopeChange?.(scopeFromRun(source, payload.run));
      if (payload.run.status === "completed") {
        stopPolling();
        setAnalyzing(false);
        onAnalysisStatusChange("ready_for_review");
        void onAnalysisComplete?.();
      } else if (payload.run.status === "failed") {
        stopPolling();
        setAnalyzing(false);
        onAnalysisStatusChange("failed");
        setError(payload.run.failureMessage ?? t("knowledge.ingest.analysisFailed"));
      }
    },
    [onAnalysisComplete, onAnalysisStatusChange, onScopeChange, source, stopPolling, t],
  );

  useEffect(() => {
    onScopeChange?.(scopeFromRun(source, run));
  }, [onScopeChange, run, source, source.analysisStatus]);

  useEffect(() => {
    if (!run || run.status !== "completed") return;
    const active = run.segments.filter(
      (segment) => segment.status !== "superseded",
    );
    const proposedRemaining = active.filter(
      (segment) => segment.status === "proposed",
    ).length;
    const confirmedCount = active.filter(
      (segment) => segment.status === "confirmed",
    ).length;
    if (proposedRemaining === 0 && confirmedCount > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load candidates after review completes on mount
      void refreshCandidates(confirmedCount);
    }
  }, [refreshCandidates, run]);

  async function startAnalysis() {
    if (!isPaste) return;
    flushSync(() => {
      setError(null);
      setAnalyzing(true);
    });
    onAnalysisStatusChange("pending");
    try {
      const response = await fetch(`/api/knowledge/sources/${source.id}/analyze`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        runId?: string;
        status?: string;
        error?: string;
        errorCode?: string;
      };
      if (!response.ok || !payload.runId) {
        throw new Error(
          resolveKnowledgeApiError(t, payload, "knowledge.ingest.analysisFailed"),
        );
      }
      setRun({
        id: payload.runId,
        status: "pending",
        segments: [],
        failureMessage: null,
      });
      onAnalysisStatusChange("processing");
      stopPolling();
      pollRef.current = setInterval(() => {
        void pollRun(source.id, payload.runId!).catch((caught) => {
          stopPolling();
          setAnalyzing(false);
          setError(
            caught instanceof Error
              ? caught.message
              : t("knowledge.ingest.analysisFailed"),
          );
        });
      }, 800);
      void pollRun(source.id, payload.runId);
    } catch (caught) {
      setAnalyzing(false);
      onAnalysisStatusChange("failed");
      setError(
        caught instanceof Error ? caught.message : t("knowledge.ingest.analysisFailed"),
      );
    }
  }

  async function updateSegmentStatus(
    segmentId: string,
    status: "proposed" | "confirmed" | "rejected",
  ) {
    setSegmentBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/knowledge/sources/${source.id}/segments/${segmentId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      const payload = (await response.json()) as {
        segment?: AnalysisSegment;
        error?: string;
        errorCode?: string;
      };
      if (!response.ok || !payload.segment) {
        setError(
          resolveKnowledgeApiError(t, payload, "knowledge.ingest.failure"),
        );
        return null;
      }
      setRun((current) => {
        if (!current) return current;
        const nextSegments = current.segments.map((segment) =>
          segment.id === segmentId ? payload.segment! : segment,
        );
        const nextRun = { ...current, segments: nextSegments };
        onScopeChange?.(scopeFromRun(source, nextRun));
        const active = nextSegments.filter(
          (segment) => segment.status !== "superseded",
        );
        const proposedRemaining = active.filter(
          (segment) => segment.status === "proposed",
        ).length;
        const confirmedCount = active.filter(
          (segment) => segment.status === "confirmed",
        ).length;
        if (proposedRemaining === 0 && confirmedCount > 0) {
          void refreshCandidates(confirmedCount);
        }
        return nextRun;
      });
      return payload.segment;
    } finally {
      setSegmentBusy(false);
    }
  }

  async function confirmAllProposedSegments() {
    const proposedIds =
      run?.segments
        .filter((segment) => segment.status === "proposed")
        .map((segment) => segment.id) ?? [];
    if (proposedIds.length === 0) return;
    setSegmentBusy(true);
    setError(null);
    try {
      for (const segmentId of proposedIds) {
        const response = await fetch(
          `/api/knowledge/sources/${source.id}/segments/${segmentId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "confirmed" }),
          },
        );
        const payload = (await response.json()) as {
          segment?: AnalysisSegment;
          error?: string;
          errorCode?: string;
        };
        if (!response.ok || !payload.segment) {
          setError(
            resolveKnowledgeApiError(t, payload, "knowledge.ingest.failure"),
          );
          break;
        }
        setRun((current) => {
          if (!current) return current;
          const nextRun = {
            ...current,
            segments: current.segments.map((segment) =>
              segment.id === segmentId ? payload.segment! : segment,
            ),
          };
          onScopeChange?.(scopeFromRun(source, nextRun));
          return nextRun;
        });
      }
      const preConfirmed =
        run?.segments.filter((segment) => segment.status === "confirmed")
          .length ?? 0;
      void refreshCandidates(preConfirmed + proposedIds.length);
    } finally {
      setSegmentBusy(false);
    }
  }

  if (!isPaste) {
    return null;
  }

  const proposedSegments =
    run?.segments.filter((segment) => segment.status === "proposed") ?? [];
  const confirmedSegments =
    run?.segments.filter((segment) => segment.status === "confirmed") ?? [];
  const rejectedSegments =
    run?.segments.filter((segment) => segment.status === "rejected") ?? [];
  const showReview =
    run?.status === "completed" && activeSegments.length > 0;
  const segmentReviewComplete =
    showReview && proposedSegments.length === 0 && confirmedSegments.length > 0;
  const showMultiTopicGuidance =
    activeSegments.length > 1 && proposedSegments.length > 0;
  const showConfirmAll = proposedSegments.length >= 2;
  const showSegmentDetailList =
    showReview && !(segmentReviewComplete && candidates.length > 0);
  const reviewTitle =
    activeSegments.length === 1
      ? t("knowledge.ingest.analysisSingleTopic")
      : t("knowledge.ingest.analysisTopicsFound", {
          count: String(activeSegments.length),
        });

  return (
    <Card className="p-4" data-ingest-step="analyze">
      <KnowledgeIngestStepHeader
        step={1}
        title={t("knowledge.ingest.analyzeContent")}
        status={
          analyzing
            ? t("knowledge.ingest.analyzingContent")
            : showReview
              ? reviewTitle
              : undefined
        }
        tone={
          analyzing
            ? "processing"
            : showReview
              ? "success"
              : "neutral"
        }
      />
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          type="button"
          data-analyze-content-button="true"
          disabled={analyzing || !source.rawText?.trim()}
          onClick={() => void startAnalysis()}
        >
          {analyzing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              {t("knowledge.ingest.analyzingContent")}
            </>
          ) : run?.status === "completed"
            ? t("knowledge.ingest.analysisRetry")
            : t("knowledge.ingest.analyzeContent")}
        </Button>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-rose-700" data-analysis-error="true">
          {error}
        </p>
      ) : null}
      {showMultiTopicGuidance ? (
        <div
          className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-950"
          data-smart-ingest-segment-guidance="true"
        >
          <p className="font-medium">
            {t("knowledge.ingest.smartIngestMultiTopicTitle", {
              count: String(activeSegments.length),
            })}
          </p>
          <p className="mt-2">{t("knowledge.ingest.smartIngestMultiTopicBody")}</p>
        </div>
      ) : null}
      {showReview ? (
        <>
          <div
            className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm crm-text"
            data-segment-review-summary="true"
          >
            <p>
              {t("knowledge.ingest.segmentReviewTopicsDetected", {
                count: String(activeSegments.length),
              })}
            </p>
            <p className="mt-1">
              {t("knowledge.ingest.segmentReviewConfirmedCount", {
                count: String(confirmedSegments.length),
              })}
              {" · "}
              {t("knowledge.ingest.segmentReviewUnconfirmedCount", {
                count: String(proposedSegments.length),
              })}
              {" · "}
              {t("knowledge.ingest.segmentReviewRejectedCount", {
                count: String(rejectedSegments.length),
              })}
            </p>
            {segmentReviewComplete ? (
              <p className="mt-2 text-xs crm-text-secondary">
                {t("knowledge.ingest.smartIngestCandidatesGeneratedCount", {
                  count: String(confirmedSegments.length),
                })}
              </p>
            ) : null}
          </div>
          {showConfirmAll ? (
            <div className="mt-3">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={segmentBusy}
                data-segment-confirm-all="true"
                onClick={() => void confirmAllProposedSegments()}
              >
                {t("knowledge.ingest.segmentConfirmAll")}
              </Button>
            </div>
          ) : null}
          {segmentReviewComplete ? (
            <KnowledgeSegmentCandidateCards
              candidates={candidates}
              loading={candidatesLoading}
              error={candidatesError}
              countMismatch={candidateCountMismatch}
              onRetry={() => void refreshCandidates(confirmedSegments.length)}
            />
          ) : null}
        {showSegmentDetailList ? (
        <ul className="mt-4 space-y-3" data-segment-review-list="true">
          {activeSegments.map((segment) => {
            const isExpanded = expanded[segment.id] ?? false;
            const excerpt =
              segment.evidenceText.length > EXCERPT_CHARS && !isExpanded
                ? `${segment.evidenceText.slice(0, EXCERPT_CHARS)}…`
                : segment.evidenceText;
            return (
              <li
                key={segment.id}
                className={cn(
                  "rounded-xl border bg-white p-4",
                  segment.status === "confirmed"
                    ? "border-emerald-200 ring-1 ring-emerald-100"
                    : segment.status === "rejected"
                      ? "border-slate-200 opacity-80"
                      : "border-slate-200",
                )}
                data-segment-card="true"
                data-segment-status={segment.status}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {t("knowledge.ingest.segmentNumber", {
                        index: String(segment.segmentIndex + 1),
                      })}
                    </p>
                    <p className="mt-1 text-base font-semibold crm-text">
                      {segment.titleHint}
                    </p>
                    <p className="mt-1 text-xs crm-text-secondary">
                      {segment.evidenceStart}–{segment.evidenceEnd}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        segment.status === "confirmed" ? "secondary" : "primary"
                      }
                      disabled={
                        segmentBusy ||
                        segment.status === "confirmed" ||
                        segment.status === "superseded"
                      }
                      data-segment-keep-button="true"
                      onClick={() =>
                        void updateSegmentStatus(segment.id, "confirmed")
                      }
                    >
                      {segment.status === "confirmed"
                        ? t("knowledge.ingest.segmentKept")
                        : t("knowledge.ingest.segmentKeep")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={
                        segmentBusy ||
                        segment.status === "rejected" ||
                        segment.status === "superseded"
                      }
                      data-segment-reject-button="true"
                      onClick={() =>
                        void updateSegmentStatus(segment.id, "rejected")
                      }
                    >
                      {segment.status === "rejected"
                        ? t("knowledge.ingest.segmentRejected")
                        : t("knowledge.ingest.segmentReject")}
                    </Button>
                  </div>
                </div>
                <p className="mt-3 text-xs font-medium crm-text-secondary">
                  {t("knowledge.ingest.segmentExcerpt")}
                </p>
                <pre
                  className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 crm-text"
                  data-segment-evidence="true"
                >
                  {excerpt}
                </pre>
                {segment.evidenceText.length > EXCERPT_CHARS ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2 min-h-9 px-0 text-blue-700"
                    onClick={() =>
                      setExpanded((current) => ({
                        ...current,
                        [segment.id]: !isExpanded,
                      }))
                    }
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="mr-1 h-4 w-4" aria-hidden="true" />
                        {t("knowledge.ingest.segmentCollapse")}
                      </>
                    ) : (
                      <>
                        <ChevronDown className="mr-1 h-4 w-4" aria-hidden="true" />
                        {t("knowledge.ingest.segmentViewFull")}
                      </>
                    )}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
        ) : null}
        </>
      ) : null}
    </Card>
  );
}
