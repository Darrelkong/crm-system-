import type { KnowledgeSourceDetail } from "@/lib/knowledge/source-service";

export type SmartIngestAnalysisRunSnapshot = {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  segments: readonly {
    status: "proposed" | "confirmed" | "rejected" | "superseded";
  }[];
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
