import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { AiProviderError } from "@/lib/ai/customer-insights/errors";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import {
  finishKnowledgeSourceOrganization,
  getKnowledgeSource,
  markKnowledgeSourceOrganizing,
  type KnowledgeSourceDetail,
  type KnowledgeSourceMeta,
} from "@/lib/knowledge/source-service";
import { buildKnowledgeAuditInsert, writeKnowledgeAudit } from "@/lib/knowledge/audit";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";
import { assessVisionExtractionReliability } from "@/lib/knowledge/knowledge-evidence-grounding";
import {
  hasSubstantiveSourceEvidence,
  isNonEvidenceExtractionText,
} from "@/lib/knowledge/knowledge-extraction-usability";
import {
  isGenerativeVisionExtraction,
  sourceBlocksOrganizeForVisionReview,
} from "@/lib/knowledge/knowledge-vision-integrity";
import {
  executeKnowledgeOrganizationOnEvidence,
  organizationFailureCodeFor,
} from "@/lib/knowledge/knowledge-organization-execution";
import { getActiveSourceLevelOrganizationRun } from "@/lib/knowledge/knowledge-organization-run-queries";
import {
  assertSourceLevelOrganizeAllowed,
  loadSmartIngestSourceScope,
  resolveOrganizerEvidenceText,
} from "@/lib/knowledge/smart-ingest-source-scope";

export const KNOWLEDGE_AI_INPUT_MAX_CHARS = 60_000;

function organizerError(code: string, message: string, status = 400) {
  return new KnowledgeServiceError(code, message, status);
}

function failureCodeFor(error: unknown): string {
  if (error instanceof AiProviderError) {
    return KNOWLEDGE_ERROR_CODES.AI_ORGANIZATION_FAILED;
  }
  return organizationFailureCodeFor(error);
}

export async function organizeKnowledgeSource(
  context: KnowledgeSessionContext,
  sourceId: string,
  meta: KnowledgeSourceMeta,
  db: Database = getDb(),
): Promise<KnowledgeSourceDetail> {
  const source = await getKnowledgeSource(context, sourceId, db);
  const smartIngestScope = await loadSmartIngestSourceScope(
    sourceId,
    source.analysisStatus,
    db,
  );
  assertSourceLevelOrganizeAllowed(smartIngestScope);
  const organizationEvidenceText = source.rawText
    ? resolveOrganizerEvidenceText(source.rawText, smartIngestScope)
    : null;
  if (!organizationEvidenceText) {
    throw organizerError(
      KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_UNAVAILABLE,
      "此来源没有可整理的文字内容",
    );
  }
  if (
    isNonEvidenceExtractionText(organizationEvidenceText) ||
    !hasSubstantiveSourceEvidence(organizationEvidenceText)
  ) {
    throw organizerError(
      KNOWLEDGE_ERROR_CODES.EXTRACTION_NEEDS_REVIEW,
      "来源文字不可用，无法作为 Knowledge 证据整理",
    );
  }
  if (organizationEvidenceText.length > KNOWLEDGE_AI_INPUT_MAX_CHARS) {
    throw organizerError(
      KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
      "来源文字超过 AI 整理的安全长度限制，请先分割来源",
    );
  }
  if (
    sourceBlocksOrganizeForVisionReview({
      extractionMethod: source.extractionMethod,
      extractionMetadata: source.extractionMetadata,
      rawText: organizationEvidenceText,
    })
  ) {
    throw organizerError(
      KNOWLEDGE_ERROR_CODES.EXTRACTION_NEEDS_REVIEW,
      "图片提取尚未通过人工确认，请先核对并确认转录内容后再整理",
    );
  }
  const extractionReliability = assessVisionExtractionReliability({
    rawText: organizationEvidenceText,
    extractionMetadata: source.extractionMetadata,
    extractionMethod: source.extractionMethod,
    extractionModel: source.extractionModel,
  });
  if (
    !isGenerativeVisionExtraction(source.extractionMethod) &&
    (!extractionReliability.ok || extractionReliability.requiresHumanReview)
  ) {
    throw organizerError(
      KNOWLEDGE_ERROR_CODES.EXTRACTION_NEEDS_REVIEW,
      "无法可靠读取来源，需要人工确认后再整理",
    );
  }
  if (!extractionReliability.ok) {
    throw organizerError(
      KNOWLEDGE_ERROR_CODES.EXTRACTION_NEEDS_REVIEW,
      "无法可靠读取来源，需要人工确认后再整理",
    );
  }
  if (await getActiveSourceLevelOrganizationRun(sourceId, db)) {
    throw organizerError(
      KNOWLEDGE_ERROR_CODES.AI_RUN_CONFLICT,
      "此来源已有进行中的 AI 整理",
      409,
    );
  }

  await markKnowledgeSourceOrganizing(context, sourceId, db);
  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  try {
    await db.insert(schema.knowledgeAiOrganizationRuns).values({
      id: runId,
      sourceId,
      candidateId: null,
      requestedByUserId: context.user.id,
      status: "pending",
      provider: null,
      model: null,
      proposedTitle: null,
      proposedSummary: null,
      proposedBody: null,
      proposedCategory: null,
      businessIdentityJson: null,
      warningsJson: null,
      createdAt: now,
      completedAt: null,
      failureCode: null,
    });
  } catch {
    await finishKnowledgeSourceOrganization(sourceId, "organized", null, db);
    throw organizerError(
      KNOWLEDGE_ERROR_CODES.AI_RUN_CONFLICT,
      "此来源已有进行中的 AI 整理",
      409,
    );
  }

  await writeKnowledgeAudit(
    {
      userId: context.user.id,
      action: "knowledge_ai_organization_started",
      entityType: "knowledge_ai_organization_run",
      entityId: runId,
      ...meta,
      metadata: { sourceId, status: "pending" },
    },
    db,
  );

  let provider = "unknown";
  let model = "unknown";
  try {
    await db
      .update(schema.knowledgeAiOrganizationRuns)
      .set({ status: "processing" })
      .where(eq(schema.knowledgeAiOrganizationRuns.id, runId));

    const executed = await executeKnowledgeOrganizationOnEvidence(
      {
        sourceTitle: source.sourceTitle,
        sourceType: source.sourceType,
        evidenceText: organizationEvidenceText,
      },
      db,
    );
    const output = executed.output;
    provider = executed.provider;
    model = executed.model;

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
        .where(eq(schema.knowledgeAiOrganizationRuns.id, runId)),
      db
        .update(schema.knowledgeSources)
        .set({
          status: "organized",
          failureCode: null,
          updatedAt: completedAt,
        })
        .where(eq(schema.knowledgeSources.id, sourceId)),
      buildKnowledgeAuditInsert(db, {
        userId: context.user.id,
        action: "knowledge_ai_organization_completed",
        entityType: "knowledge_ai_organization_run",
        entityId: runId,
        ...meta,
        metadata: {
          sourceId,
          runId,
          status: "completed",
          provider,
          model,
          extractionMethod: source.extractionMethod,
          extractionModel: source.extractionModel,
          extractionMetadataVersion:
            source.extractionMetadata?.schemaVersion ?? null,
        },
      }),
    ]);
  } catch (error) {
    const failureCode = failureCodeFor(error);
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
      db
        .update(schema.knowledgeSources)
        .set({
          status: "failed",
          failureCode,
          updatedAt: failureAt,
        })
        .where(eq(schema.knowledgeSources.id, sourceId)),
      buildKnowledgeAuditInsert(db, {
        userId: context.user.id,
        action: "knowledge_ai_organization_failed",
        entityType: "knowledge_ai_organization_run",
        entityId: runId,
        ...meta,
        metadata: { sourceId, status: "failed", failureCode },
      }),
    ]);
    throw error instanceof KnowledgeServiceError
      ? error
      : organizerError(
          KNOWLEDGE_ERROR_CODES.AI_ORGANIZATION_FAILED,
          "AI 整理失败，请稍后再试",
          503,
        );
  }

  return getKnowledgeSource(context, sourceId, db);
}
