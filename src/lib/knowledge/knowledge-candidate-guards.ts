import { and, eq, sql, type SQL } from "drizzle-orm";
import { getDb, schema, type Database } from "@/lib/db";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import { requireManageableKnowledgeSource } from "@/lib/knowledge/source-service";
import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";

export type CandidateIdentity = { id: string; sourceId: string; analysisRunId: string };

export function candidateConflict(): KnowledgeServiceError {
  return new KnowledgeServiceError(
    KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
    "主题状态已变更，请刷新后重试",
    409,
  );
}

/** Monotonic even when two classifications happen in the same millisecond. */
export function nextCandidateRevision(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}

/** Re-evaluated by D1 in the statement/batch that commits the mutation. */
export function currentCandidateCondition(
  candidate: CandidateIdentity,
  context?: KnowledgeSessionContext,
): SQL {
  const authority = context
    ? context.role === "knowledge_admin"
      ? sql`1 = 1`
      : sql`${context.role === "contributor" ? 1 : 0} = 1 AND s.created_by_user_id = ${context.user.id}`
    : sql`1 = 1`;
  return sql`EXISTS (
    SELECT 1 FROM knowledge_source_segment_candidates c
    JOIN knowledge_sources s ON s.id = c.source_id
    JOIN knowledge_source_segments seg ON seg.id = c.segment_id
    JOIN knowledge_source_analysis_runs ar ON ar.id = c.analysis_run_id
    WHERE c.id = ${candidate.id} AND c.source_id = ${candidate.sourceId}
      AND c.analysis_run_id = ${candidate.analysisRunId}
      AND c.status IN ('pending', 'ready')
      AND c.superseded_at IS NULL AND c.superseded_by_analysis_run_id IS NULL
      AND seg.source_id = c.source_id AND seg.analysis_run_id = c.analysis_run_id
      AND seg.status = 'confirmed'
      AND ar.source_id = c.source_id AND ar.status = 'completed'
      AND ar.rowid = (SELECT rowid FROM knowledge_source_analysis_runs
        WHERE source_id = c.source_id ORDER BY created_at DESC, rowid DESC LIMIT 1)
      AND s.archived_at IS NULL AND s.status IN ('ready', 'organized')
      AND s.analysis_status = 'ready_for_review' AND s.linked_article_id IS NULL
      AND ${authority}
  )`;
}

export function currentCandidateOrganizationCondition(
  candidate: CandidateIdentity,
  organizationRunId: string,
): SQL {
  return sql`EXISTS (
    SELECT 1 FROM knowledge_ai_organization_runs org
    WHERE org.id = ${organizationRunId} AND org.candidate_id = ${candidate.id}
      AND org.source_id = ${candidate.sourceId} AND org.status = 'completed'
      AND org.rowid = (SELECT rowid FROM knowledge_ai_organization_runs
        WHERE candidate_id = ${candidate.id} ORDER BY created_at DESC, rowid DESC LIMIT 1)
  )`;
}

export async function requireCurrentCandidate(
  context: KnowledgeSessionContext,
  sourceId: string,
  candidateId: string,
  db: Database = getDb(),
) {
  await requireManageableKnowledgeSource(context, sourceId, db);
  const candidate = (await db.select().from(schema.knowledgeSourceSegmentCandidates)
    .where(and(eq(schema.knowledgeSourceSegmentCandidates.id, candidateId),
      eq(schema.knowledgeSourceSegmentCandidates.sourceId, sourceId))).limit(1))[0];
  if (!candidate) {
    throw new KnowledgeServiceError(KNOWLEDGE_ERROR_CODES.SOURCE_NOT_FOUND, "主题候选不存在", 404);
  }
  const current = (await db.select({ id: schema.knowledgeSourceSegmentCandidates.id })
    .from(schema.knowledgeSourceSegmentCandidates)
    .where(and(eq(schema.knowledgeSourceSegmentCandidates.id, candidateId),
      currentCandidateCondition(candidate, context))).limit(1))[0];
  if (!current) throw candidateConflict();
  return candidate;
}
