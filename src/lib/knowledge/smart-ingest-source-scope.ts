import { and, desc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import type { KnowledgeSourceAnalysisStatus } from "../../../drizzle/schema/knowledge-sources";
import type { KnowledgeSourceSegmentStatus } from "../../../drizzle/schema/knowledge-source-segments";

export const SMART_INGEST_SEGMENT_SCOPE_REQUIRED_MESSAGE =
  "已识别多个独立主题，请先确认主题后分别整理。";

export type SmartIngestSegmentSnapshot = {
  id: string;
  segmentIndex: number;
  titleHint: string;
  evidenceText: string;
  evidenceStart: number;
  evidenceEnd: number;
  status: KnowledgeSourceSegmentStatus;
};

export type SmartIngestSourceScope = {
  analysisStatus: KnowledgeSourceAnalysisStatus;
  latestAnalysisRunId: string | null;
  segments: SmartIngestSegmentSnapshot[];
  /** Segments awaiting explicit human confirmation. */
  unconfirmedProposedCount: number;
  confirmedSegmentCount: number;
  rejectedSegmentCount: number;
  /** @deprecated Use unconfirmedProposedCount — kept for callers during transition */
  retainedProposedSegmentCount: number;
  /** Non-superseded segments from the latest completed analysis run. */
  activeSegmentCount: number;
  blocksSourceLevelOrganize: boolean;
  blocksSourceLevelComparison: boolean;
  singleSegmentId: string | null;
  singleSegmentEvidenceText: string | null;
};

export function countUnconfirmedProposedSegments(
  segments: readonly { status: KnowledgeSourceSegmentStatus }[],
): number {
  return segments.filter((segment) => segment.status === "proposed").length;
}

/** @deprecated Use countUnconfirmedProposedSegments */
export function countRetainedProposedSegments(
  segments: readonly { status: KnowledgeSourceSegmentStatus }[],
): number {
  return countUnconfirmedProposedSegments(segments);
}

export function countActiveAnalysisSegments(
  segments: readonly { status: KnowledgeSourceSegmentStatus }[],
): number {
  return segments.filter((segment) => segment.status !== "superseded").length;
}

function pickSingleSegmentEvidenceSegment(
  segments: readonly SmartIngestSegmentSnapshot[],
): SmartIngestSegmentSnapshot | null {
  const active = segments.filter((segment) => segment.status !== "superseded");
  if (active.length !== 1) return null;
  const only = active[0]!;
  if (only.status === "rejected") return null;
  return only;
}

export function deriveSmartIngestSourceScope(input: {
  analysisStatus: KnowledgeSourceAnalysisStatus;
  latestAnalysisRunId: string | null;
  segments: readonly SmartIngestSegmentSnapshot[];
}): SmartIngestSourceScope {
  const unconfirmedProposedCount = countUnconfirmedProposedSegments(input.segments);
  const confirmedSegmentCount = input.segments.filter(
    (segment) => segment.status === "confirmed",
  ).length;
  const rejectedSegmentCount = input.segments.filter(
    (segment) => segment.status === "rejected",
  ).length;
  const activeSegmentCount = countActiveAnalysisSegments(input.segments);
  const inReview = input.analysisStatus === "ready_for_review";
  const blocksSourceLevelOrganize = inReview && activeSegmentCount > 1;
  const blocksSourceLevelComparison = blocksSourceLevelOrganize;
  const single = pickSingleSegmentEvidenceSegment(input.segments);

  return {
    analysisStatus: input.analysisStatus,
    latestAnalysisRunId: input.latestAnalysisRunId,
    segments: [...input.segments],
    unconfirmedProposedCount,
    confirmedSegmentCount,
    rejectedSegmentCount,
    retainedProposedSegmentCount: unconfirmedProposedCount,
    activeSegmentCount,
    blocksSourceLevelOrganize,
    blocksSourceLevelComparison,
    singleSegmentId: single?.id ?? null,
    singleSegmentEvidenceText: single?.evidenceText ?? null,
  };
}

export async function loadSmartIngestSourceScope(
  sourceId: string,
  analysisStatus: KnowledgeSourceAnalysisStatus,
  db: Database,
): Promise<SmartIngestSourceScope> {
  if (analysisStatus !== "ready_for_review") {
    return deriveSmartIngestSourceScope({
      analysisStatus,
      latestAnalysisRunId: null,
      segments: [],
    });
  }

  const latestRun = (
    await db
      .select()
      .from(schema.knowledgeSourceAnalysisRuns)
      .where(
        and(
          eq(schema.knowledgeSourceAnalysisRuns.sourceId, sourceId),
          eq(schema.knowledgeSourceAnalysisRuns.status, "completed"),
        ),
      )
      .orderBy(desc(schema.knowledgeSourceAnalysisRuns.createdAt))
      .limit(1)
  )[0];

  if (!latestRun) {
    return deriveSmartIngestSourceScope({
      analysisStatus,
      latestAnalysisRunId: null,
      segments: [],
    });
  }

  const segments = await db
    .select({
      id: schema.knowledgeSourceSegments.id,
      segmentIndex: schema.knowledgeSourceSegments.segmentIndex,
      titleHint: schema.knowledgeSourceSegments.titleHint,
      evidenceText: schema.knowledgeSourceSegments.evidenceText,
      evidenceStart: schema.knowledgeSourceSegments.evidenceStart,
      evidenceEnd: schema.knowledgeSourceSegments.evidenceEnd,
      status: schema.knowledgeSourceSegments.status,
    })
    .from(schema.knowledgeSourceSegments)
    .where(eq(schema.knowledgeSourceSegments.analysisRunId, latestRun.id));

  return deriveSmartIngestSourceScope({
    analysisStatus,
    latestAnalysisRunId: latestRun.id,
    segments,
  });
}

export function assertSourceLevelOrganizeAllowed(scope: SmartIngestSourceScope): void {
  if (!scope.blocksSourceLevelOrganize) {
    if (
      scope.analysisStatus === "ready_for_review" &&
      scope.activeSegmentCount > 0 &&
      scope.confirmedSegmentCount === 0 &&
      scope.unconfirmedProposedCount === 0 &&
      scope.rejectedSegmentCount === scope.activeSegmentCount
    ) {
      throw new KnowledgeServiceError(
        KNOWLEDGE_ERROR_CODES.SMART_INGEST_SEGMENT_SCOPE_REQUIRED,
        "没有保留的主题可供整理，请先保留至少一个主题。",
        409,
      );
    }
    return;
  }
  throw new KnowledgeServiceError(
    KNOWLEDGE_ERROR_CODES.SMART_INGEST_SEGMENT_SCOPE_REQUIRED,
    SMART_INGEST_SEGMENT_SCOPE_REQUIRED_MESSAGE,
    409,
  );
}

export function assertSourceLevelComparisonAllowed(scope: SmartIngestSourceScope): void {
  if (!scope.blocksSourceLevelComparison) return;
  throw new KnowledgeServiceError(
    KNOWLEDGE_ERROR_CODES.SMART_INGEST_SEGMENT_SCOPE_REQUIRED,
    SMART_INGEST_SEGMENT_SCOPE_REQUIRED_MESSAGE,
    409,
  );
}

export function resolveOrganizerEvidenceText(
  sourceRawText: string,
  scope: SmartIngestSourceScope,
): string {
  if (
    scope.analysisStatus === "ready_for_review" &&
    scope.singleSegmentEvidenceText
  ) {
    return scope.singleSegmentEvidenceText;
  }
  return sourceRawText;
}
