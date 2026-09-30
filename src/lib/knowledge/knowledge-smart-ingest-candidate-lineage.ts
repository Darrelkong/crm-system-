import type { KnowledgeSourceDetail } from "@/lib/knowledge/source-service";

export type SmartIngestAnalysisRunSnapshot = {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  segments: readonly {
    status: "proposed" | "confirmed" | "rejected" | "superseded";
  }[];
};

export type SmartIngestDisplayRunSegment = {
  id: string;
  segmentIndex: number;
  titleHint: string;
  evidenceText: string;
  evidenceStart: number;
  evidenceEnd: number;
  status: "proposed" | "confirmed" | "rejected" | "superseded";
  createdAt: string;
};

export type SmartIngestDisplayRun = {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  failureMessage: string | null;
  segments: SmartIngestDisplayRunSegment[];
};

export function resolveStableAnalysisRunId(
  source: Pick<KnowledgeSourceDetail, "smartIngestScope">,
  run: SmartIngestAnalysisRunSnapshot | null,
): string | null {
  if (run?.status === "completed" && run.id) {
    return run.id;
  }
  return source.smartIngestScope.latestAnalysisRunId ?? null;
}

export function buildCandidateLineageKey(
  sourceId: string,
  analysisRunId: string,
): string {
  return `${sourceId}:${analysisRunId}`;
}

export function shouldResetCandidateLineage(
  previousLineageKey: string | null,
  nextLineageKey: string,
): boolean {
  if (previousLineageKey === null) {
    return false;
  }
  return previousLineageKey !== nextLineageKey;
}

/**
 * Prefer parent source scope for a completed run instead of syncing run state in an effect.
 * Keeps stable lineage when run is transiently null while source scope still references run A.
 */
export function resolveSmartIngestDisplayRun(
  source: Pick<KnowledgeSourceDetail, "analysisStatus" | "smartIngestScope">,
  run: SmartIngestDisplayRun | null,
  analyzing: boolean,
): SmartIngestDisplayRun | null {
  const stableAnalysisRunId = resolveStableAnalysisRunId(source, run);
  if (
    analyzing ||
    run?.status === "pending" ||
    run?.status === "processing"
  ) {
    return run;
  }
  if (run?.status === "failed") {
    return run;
  }
  if (run?.status === "completed" && run.id === stableAnalysisRunId) {
    return run;
  }
  if (
    stableAnalysisRunId &&
    source.analysisStatus === "ready_for_review" &&
    source.smartIngestScope.latestAnalysisRunId === stableAnalysisRunId &&
    source.smartIngestScope.segments.length > 0
  ) {
    return {
      id: stableAnalysisRunId,
      status: "completed",
      failureMessage: null,
      segments: source.smartIngestScope.segments.map((segment) => ({
        ...segment,
        createdAt: "",
      })),
    };
  }
  return run;
}

export function confirmedSegmentCountFromScope(
  source: Pick<KnowledgeSourceDetail, "smartIngestScope">,
  run: SmartIngestAnalysisRunSnapshot | null,
): number {
  if (run?.status === "completed") {
    return run.segments.filter(
      (segment) =>
        segment.status !== "superseded" && segment.status === "confirmed",
    ).length;
  }
  return source.smartIngestScope.segments.filter(
    (segment) =>
      segment.status !== "superseded" && segment.status === "confirmed",
  ).length;
}
