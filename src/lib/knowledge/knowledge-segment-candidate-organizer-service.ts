import { candidateConflict, currentCandidateCondition, requireCurrentCandidate } from "@/lib/knowledge/knowledge-candidate-guards";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  executeKnowledgeOrganizationOnEvidence,
  organizationFailureCodeFor,
} from "@/lib/knowledge/knowledge-organization-execution";
import {
  getActiveCandidateOrganizationRun,
  latestCandidateOrganization,
  mapOrganizationRun,
} from "@/lib/knowledge/knowledge-organization-run-queries";
import { buildKnowledgeAuditInsert, buildKnowledgeAuditInsertWhere } from "@/lib/knowledge/audit";
import {
  canManageKnowledgeSource,
  getKnowledgeSource,
  type KnowledgeSourceMeta,
} from "@/lib/knowledge/source-service";
import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";
import { loadSmartIngestSourceScope } from "@/lib/knowledge/smart-ingest-source-scope";
import {
  hasSubstantiveSourceEvidence,
  isNonEvidenceExtractionText,
} from "@/lib/knowledge/knowledge-extraction-usability";
import { KNOWLEDGE_AI_INPUT_MAX_CHARS } from "@/lib/knowledge/ai-organizer-service";
import { applyCandidateBusinessFromEvidence } from "@/lib/knowledge/knowledge-segment-candidate-classification";
import type { KnowledgeSegmentCandidateDetail } from "@/lib/knowledge/knowledge-segment-candidate-service";
import { listKnowledgeSegmentCandidates } from "@/lib/knowledge/knowledge-segment-candidate-service";

function candidateOrganizerError(
  code: string,
  message: string,
  status = 400,
): KnowledgeServiceError {
  return new KnowledgeServiceError(code, message, status);
}

export async function getActiveSegmentCandidate(
  context: KnowledgeSessionContext,
  sourceId: string,
  candidateId: string,
  db: Database = getDb(),
) {
  await requireCurrentCandidate(context, sourceId, candidateId, db);
  const candidates = await listKnowledgeSegmentCandidates(context, sourceId, db);
  const candidate = candidates.find((row) => row.id === candidateId);
  if (!candidate) {
    throw candidateOrganizerError(
      KNOWLEDGE_ERROR_CODES.SOURCE_NOT_FOUND,
      "主题候选不存在",
      404,
    );
  }
  if (candidate.status === "superseded") {
    throw candidateOrganizerError(
      KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
      "该主题候选已失效，请重新分析来源",
      409,
    );
  }
  if (candidate.segmentStatus !== "confirmed") {
    throw candidateOrganizerError(
      KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
      "仅已确认的主题可独立整理",
      409,
    );
  }
  return candidate;
}

function assertCandidateEvidenceInvariant(
  candidate: KnowledgeSegmentCandidateDetail,
  sourceRawText: string | null,
  confirmedSegmentCount: number,
): string {
  const evidenceText = candidate.segmentEvidenceText.trim();
  if (!evidenceText) {
    throw candidateOrganizerError(
      KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_UNAVAILABLE,
      "此主题没有可整理的文字内容",
    );
  }
  if (
    isNonEvidenceExtractionText(evidenceText) ||
    !hasSubstantiveSourceEvidence(evidenceText)
  ) {
    throw candidateOrganizerError(
      KNOWLEDGE_ERROR_CODES.EXTRACTION_NEEDS_REVIEW,
      "主题文字不可用，无法作为 Knowledge 证据整理",
    );
  }
  if (evidenceText.length > KNOWLEDGE_AI_INPUT_MAX_CHARS) {
    throw candidateOrganizerError(
      KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
      "主题文字超过 AI 整理的安全长度限制",
    );
  }
  if (
    confirmedSegmentCount > 1 &&
    sourceRawText &&
    evidenceText === sourceRawText.trim()
  ) {
    throw candidateOrganizerError(
      KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
      "多主题来源必须使用分段证据整理",
    );
  }
  return evidenceText;
}

export async function organizeKnowledgeSegmentCandidate(
  context: KnowledgeSessionContext,
  sourceId: string,
  candidateId: string,
  meta: KnowledgeSourceMeta,
  db: Database = getDb(),
  dependencies: { execute?: typeof executeKnowledgeOrganizationOnEvidence } = {},
): Promise<KnowledgeSegmentCandidateDetail> {
  const source = await getKnowledgeSource(context, sourceId, db);
  const sourceRow = (
    await db
      .select()
      .from(schema.knowledgeSources)
      .where(eq(schema.knowledgeSources.id, sourceId))
      .limit(1)
  )[0];
  if (!sourceRow || !canManageKnowledgeSource(context, sourceRow)) {
    throw candidateOrganizerError(
      KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED,
      "来源访问被拒绝",
      403,
    );
  }
  const candidate = await getActiveSegmentCandidate(
    context,
    sourceId,
    candidateId,
    db,
  );
  const scope = await loadSmartIngestSourceScope(
    sourceId,
    source.analysisStatus,
    db,
  );
  const evidenceText = assertCandidateEvidenceInvariant(
    candidate,
    source.rawText,
    scope.confirmedSegmentCount,
  );

  if (await getActiveCandidateOrganizationRun(candidateId, db)) {
    throw candidateOrganizerError(
      KNOWLEDGE_ERROR_CODES.AI_RUN_CONFLICT,
      "此主题已有进行中的 AI 整理",
      409,
    );
  }

  await applyCandidateBusinessFromEvidence(
    (
      await db
        .select()
        .from(schema.knowledgeSourceSegmentCandidates)
        .where(eq(schema.knowledgeSourceSegmentCandidates.id, candidateId))
        .limit(1)
    )[0]!,
    evidenceText,
    db,
  );

  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const identity = { id: candidateId, sourceId, analysisRunId: candidate.analysisRunId };
  const runExists = sql`EXISTS (SELECT 1 FROM knowledge_ai_organization_runs WHERE id = ${runId})`;
  try {
    await db.batch([
      db.insert(schema.knowledgeAiOrganizationRuns).select(sql`
        SELECT ${runId}, ${sourceId}, ${candidateId}, ${context.user.id}, 'pending',
          NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ${now}, NULL, NULL
        WHERE ${currentCandidateCondition(identity, context)}
      `),
      buildKnowledgeAuditInsertWhere(db, {
        userId: context.user.id, action: "knowledge_ai_organization_started",
        entityType: "knowledge_ai_organization_run", entityId: runId, ...meta,
        metadata: { sourceId, candidateId, status: "pending" },
      }, runExists),
    ]);
  } catch {
    throw candidateOrganizerError(KNOWLEDGE_ERROR_CODES.AI_RUN_CONFLICT, "此主题已有进行中的 AI 整理", 409);
  }
  if (!(await db.select().from(schema.knowledgeAiOrganizationRuns)
    .where(eq(schema.knowledgeAiOrganizationRuns.id, runId)).limit(1))[0]) throw candidateConflict();

  let provider = "unknown";
  let model = "unknown";
  try {
    await db
      .update(schema.knowledgeAiOrganizationRuns)
      .set({ status: "processing" })
      .where(eq(schema.knowledgeAiOrganizationRuns.id, runId));

    const executed = await (dependencies.execute ?? executeKnowledgeOrganizationOnEvidence)(
      {
        sourceTitle: candidate.segmentTitleHint,
        sourceType: source.sourceType,
        evidenceText,
      },
      db,
    );
    provider = executed.provider;
    model = executed.model;
    const output = executed.output;
    const completedAt = new Date().toISOString();

    await db.batch([
      db
        .update(schema.knowledgeAiOrganizationRuns)
        .set({
          status: "completed",
          provider,
          model,
          proposedTitle: output.title,
          proposedSummary: output.summary,
          proposedBody: output.body,
          proposedCategory: output.suggestedCategory,
          businessIdentityJson: executed.businessIdentityJson,
          warningsJson: JSON.stringify(output.warnings),
          completedAt,
          failureCode: null,
        })
        .where(and(eq(schema.knowledgeAiOrganizationRuns.id, runId),
          eq(schema.knowledgeAiOrganizationRuns.status, "processing"),
          currentCandidateCondition(identity, context))),
      db
        .update(schema.knowledgeSourceSegmentCandidates)
        .set({
          status: "ready",
          updatedAt: sql`CASE WHEN updated_at >= ${completedAt}
            THEN strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds') ELSE ${completedAt} END`,
        })
        .where(and(eq(schema.knowledgeSourceSegmentCandidates.id, candidateId),
          currentCandidateCondition(identity, context),
          sql`EXISTS (SELECT 1 FROM knowledge_ai_organization_runs WHERE id = ${runId} AND status = 'completed')`)),
      buildKnowledgeAuditInsertWhere(db, {
        userId: context.user.id,
        action: "knowledge_ai_organization_completed",
        entityType: "knowledge_ai_organization_run",
        entityId: runId,
        ...meta,
        metadata: {
          sourceId,
          candidateId,
          runId,
          status: "completed",
          provider,
          model,
        },
      }, sql`EXISTS (SELECT 1 FROM knowledge_ai_organization_runs WHERE id = ${runId} AND status = 'completed')`),
    ]);
    const completed = (await db.select().from(schema.knowledgeAiOrganizationRuns)
      .where(eq(schema.knowledgeAiOrganizationRuns.id, runId)).limit(1))[0];
    if (completed?.status !== "completed") throw candidateConflict();
  } catch (error) {
    const failureCode = organizationFailureCodeFor(error);
    const failureAt = new Date().toISOString();
    await db.batch([
      db
        .update(schema.knowledgeAiOrganizationRuns)
        .set({
          status: "failed",
          provider,
          model,
          completedAt: failureAt,
          failureCode,
        })
        .where(eq(schema.knowledgeAiOrganizationRuns.id, runId)),
      buildKnowledgeAuditInsert(db, {
        userId: context.user.id,
        action: "knowledge_ai_organization_failed",
        entityType: "knowledge_ai_organization_run",
        entityId: runId,
        ...meta,
        metadata: { sourceId, candidateId, status: "failed", failureCode },
      }),
    ]);
    throw error instanceof KnowledgeServiceError
      ? error
      : candidateOrganizerError(
          KNOWLEDGE_ERROR_CODES.AI_ORGANIZATION_FAILED,
          "AI 整理失败，请稍后再试",
          503,
        );
  }

  const refreshed = await listKnowledgeSegmentCandidates(context, sourceId, db);
  return refreshed.find((row) => row.id === candidateId)!;
}

export async function getCandidateOrganizationForDraft(
  context: KnowledgeSessionContext,
  sourceId: string,
  candidateId: string,
  db: Database = getDb(),
) {
  await getActiveSegmentCandidate(context, sourceId, candidateId, db);
  const run = await latestCandidateOrganization(candidateId, db);
  if (run && run.sourceId !== sourceId) throw candidateConflict();
  return mapOrganizationRun(run);
}

export async function getLatestCandidateOrganizationRunId(
  candidateId: string,
  db: Database = getDb(),
): Promise<string | null> {
  const run = await latestCandidateOrganization(candidateId, db);
  return run?.id ?? null;
}
