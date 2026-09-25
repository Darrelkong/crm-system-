import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  canManageKnowledgeSource,
  requireKnowledgeIngestRole,
} from "@/lib/knowledge/source-service";
import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";
import type { KnowledgeSourceSegmentCandidate } from "../../../drizzle/schema/knowledge-source-segment-candidates";
import type { KnowledgeSourceSegmentStatus } from "../../../drizzle/schema/knowledge-source-segments";
import type { KnowledgeAiRunStatus } from "../../../drizzle/schema/knowledge-ai-organization-runs";
import { latestCandidateOrganization } from "@/lib/knowledge/knowledge-organization-run-queries";
import { applyCandidateBusinessFromEvidence } from "@/lib/knowledge/knowledge-segment-candidate-classification";

function candidateError(
  code: string,
  message: string,
  status = 400,
): KnowledgeServiceError {
  return new KnowledgeServiceError(code, message, status);
}

export type KnowledgeSegmentCandidateDetail = {
  id: string;
  sourceId: string;
  segmentId: string;
  analysisRunId: string;
  segmentIndex: number;
  status: KnowledgeSourceSegmentCandidate["status"];
  requestedProjectCode: string | null;
  knowledgeCategoryId: string | null;
  categoryResolutionSource: string | null;
  manualRequestedProjectOverride: boolean;
  manualCategoryOverride: boolean;
  createdAt: string;
  updatedAt: string;
  supersededAt: string | null;
  supersededByAnalysisRunId: string | null;
  segmentTitleHint: string;
  segmentEvidenceText: string;
  segmentStatus: KnowledgeSourceSegmentStatus;
  organizationStatus: KnowledgeAiRunStatus | null;
  organizationFailureCode: string | null;
  organizationCompleted: boolean;
  draftArticleId: string | null;
  convertedAt: string | null;
};

function mapCandidateRow(
  row: KnowledgeSourceSegmentCandidate,
  segment: {
    titleHint: string;
    evidenceText: string;
    status: KnowledgeSourceSegmentStatus;
  },
  organization: {
    status: KnowledgeAiRunStatus | null;
    failureCode: string | null;
  } = { status: null, failureCode: null },
): KnowledgeSegmentCandidateDetail {
  return {
    id: row.id,
    sourceId: row.sourceId,
    segmentId: row.segmentId,
    analysisRunId: row.analysisRunId,
    segmentIndex: row.segmentIndex,
    status: row.status,
    requestedProjectCode: row.requestedProjectCode,
    knowledgeCategoryId: row.knowledgeCategoryId,
    categoryResolutionSource: row.categoryResolutionSource,
    manualRequestedProjectOverride: row.manualRequestedProjectOverride,
    manualCategoryOverride: row.manualCategoryOverride,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    supersededAt: row.supersededAt,
    supersededByAnalysisRunId: row.supersededByAnalysisRunId,
    segmentTitleHint: segment.titleHint,
    segmentEvidenceText: segment.evidenceText,
    segmentStatus: segment.status,
    organizationStatus: organization.status,
    organizationFailureCode: organization.failureCode,
    organizationCompleted: organization.status === "completed",
    draftArticleId: row.draftArticleId,
    convertedAt: row.convertedAt,
  };
}

async function getLatestCompletedAnalysisRun(sourceId: string, db: Database) {
  return (
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
  )[0] ?? null;
}

async function loadSegmentsForRun(analysisRunId: string, db: Database) {
  return db
    .select()
    .from(schema.knowledgeSourceSegments)
    .where(eq(schema.knowledgeSourceSegments.analysisRunId, analysisRunId))
    .orderBy(schema.knowledgeSourceSegments.segmentIndex);
}

export function segmentReviewCompleteForRun(
  segments: readonly { status: KnowledgeSourceSegmentStatus }[],
): boolean {
  const active = segments.filter((segment) => segment.status !== "superseded");
  if (active.length === 0) return false;
  return active.every((segment) => segment.status !== "proposed");
}

export async function supersedeKnowledgeSegmentCandidatesForReanalysis(
  sourceId: string,
  newAnalysisRunId: string,
  db: Database = getDb(),
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .update(schema.knowledgeSourceSegmentCandidates)
    .set({
      status: "superseded",
      supersededAt: now,
      supersededByAnalysisRunId: newAnalysisRunId,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.knowledgeSourceSegmentCandidates.sourceId, sourceId),
        inArray(schema.knowledgeSourceSegmentCandidates.status, [
          "pending",
          "ready",
        ]),
      ),
    );
}

export async function materializeKnowledgeSegmentCandidatesForSource(
  context: KnowledgeSessionContext,
  sourceId: string,
  db: Database = getDb(),
): Promise<KnowledgeSegmentCandidateDetail[]> {
  requireKnowledgeIngestRole(context);
  const source = (
    await db
      .select()
      .from(schema.knowledgeSources)
      .where(eq(schema.knowledgeSources.id, sourceId))
      .limit(1)
  )[0];
  if (!source) {
    throw candidateError(KNOWLEDGE_ERROR_CODES.SOURCE_NOT_FOUND, "来源不存在", 404);
  }
  if (!canManageKnowledgeSource(context, source)) {
    throw candidateError(
      KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED,
      "来源访问被拒绝",
      403,
    );
  }

  const run = await getLatestCompletedAnalysisRun(sourceId, db);
  if (!run) {
    return [];
  }

  const segments = await loadSegmentsForRun(run.id, db);
  const confirmed = segments.filter((segment) => segment.status === "confirmed");
  if (confirmed.length === 0) {
    return listKnowledgeSegmentCandidates(context, sourceId, db);
  }
  const now = new Date().toISOString();

  for (const segment of confirmed) {
    const existing = (
      await db
        .select()
        .from(schema.knowledgeSourceSegmentCandidates)
        .where(eq(schema.knowledgeSourceSegmentCandidates.segmentId, segment.id))
        .limit(1)
    )[0];
    if (existing) {
      continue;
    }
    const candidateId = crypto.randomUUID();
    await db.insert(schema.knowledgeSourceSegmentCandidates).values({
      id: candidateId,
      sourceId,
      segmentId: segment.id,
      analysisRunId: run.id,
      segmentIndex: segment.segmentIndex,
      status: "pending",
      requestedProjectCode: null,
      knowledgeCategoryId: null,
      categoryResolutionSource: null,
      manualRequestedProjectOverride: false,
      manualCategoryOverride: false,
      createdByUserId: context.user.id,
      createdAt: now,
      updatedAt: now,
      supersededAt: null,
      supersededByAnalysisRunId: null,
    });
    const inserted = (
      await db
        .select()
        .from(schema.knowledgeSourceSegmentCandidates)
        .where(eq(schema.knowledgeSourceSegmentCandidates.id, candidateId))
        .limit(1)
    )[0]!;
    await applyCandidateBusinessFromEvidence(
      inserted,
      segment.evidenceText,
      db,
    );
  }

  return listKnowledgeSegmentCandidates(context, sourceId, db);
}

export async function maybeMaterializeKnowledgeSegmentCandidates(
  context: KnowledgeSessionContext,
  sourceId: string,
  db: Database = getDb(),
): Promise<void> {
  const run = await getLatestCompletedAnalysisRun(sourceId, db);
  if (!run) return;
  await materializeKnowledgeSegmentCandidatesForSource(context, sourceId, db);
}

export async function listKnowledgeSegmentCandidates(
  context: KnowledgeSessionContext,
  sourceId: string,
  db: Database = getDb(),
  options: { includeSuperseded?: boolean } = {},
): Promise<KnowledgeSegmentCandidateDetail[]> {
  requireKnowledgeIngestRole(context);
  const source = (
    await db
      .select()
      .from(schema.knowledgeSources)
      .where(eq(schema.knowledgeSources.id, sourceId))
      .limit(1)
  )[0];
  if (!source) {
    throw candidateError(KNOWLEDGE_ERROR_CODES.SOURCE_NOT_FOUND, "来源不存在", 404);
  }
  if (!canManageKnowledgeSource(context, source)) {
    throw candidateError(
      KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED,
      "来源访问被拒绝",
      403,
    );
  }

  const statusFilter = options.includeSuperseded
    ? undefined
    : inArray(schema.knowledgeSourceSegmentCandidates.status, [
        "pending",
        "ready",
      ]);

  const rows = await db
    .select({
      candidate: schema.knowledgeSourceSegmentCandidates,
      segment: schema.knowledgeSourceSegments,
    })
    .from(schema.knowledgeSourceSegmentCandidates)
    .innerJoin(
      schema.knowledgeSourceSegments,
      eq(
        schema.knowledgeSourceSegmentCandidates.segmentId,
        schema.knowledgeSourceSegments.id,
      ),
    )
    .where(
      statusFilter
        ? and(
            eq(schema.knowledgeSourceSegmentCandidates.sourceId, sourceId),
            statusFilter,
          )
        : eq(schema.knowledgeSourceSegmentCandidates.sourceId, sourceId),
    )
    .orderBy(schema.knowledgeSourceSegmentCandidates.segmentIndex);

  const mapped: KnowledgeSegmentCandidateDetail[] = [];
  for (const row of rows) {
    const orgRun = await latestCandidateOrganization(row.candidate.id, db);
    mapped.push(
      mapCandidateRow(row.candidate, row.segment, {
        status: orgRun?.status ?? null,
        failureCode: orgRun?.failureCode ?? null,
      }),
    );
  }
  return mapped;
}

export async function getKnowledgeSegmentCandidate(
  context: KnowledgeSessionContext,
  sourceId: string,
  candidateId: string,
  db: Database = getDb(),
): Promise<KnowledgeSegmentCandidateDetail | null> {
  const list = await listKnowledgeSegmentCandidates(context, sourceId, db);
  return list.find((row) => row.id === candidateId) ?? null;
}
