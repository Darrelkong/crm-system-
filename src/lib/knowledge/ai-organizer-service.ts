import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { allowMockDeepInsightGeneration } from "@/lib/ai/providers/factory";
import { AiProviderError } from "@/lib/ai/customer-insights/errors";
import {
  KNOWLEDGE_CLOUDFLARE_AI_MODEL,
  KNOWLEDGE_CLOUDFLARE_AI_PROVIDER,
} from "@/lib/knowledge/cloudflare-knowledge-ai";
import { getEffectiveAiSettings } from "@/lib/settings/ai-effective";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import {
  buildKnowledgeOrganizerSystemPrompt,
  buildKnowledgeOrganizerUserPrompt,
} from "@/lib/knowledge/ai-organizer-prompt";
import {
  parseKnowledgeAiOrganizationOutput,
  type KnowledgeAiOrganizationOutput,
} from "@/lib/knowledge/ai-organizer-schema";
import {
  callKnowledgeOrganizationProvider,
  KnowledgeAiProviderOutputError,
} from "@/lib/knowledge/ai-organizer-provider";
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
import {
  assessOrganizerOutputCompleteness,
  assessVisionExtractionReliability,
  validateOrganizerEvidenceGrounding,
} from "@/lib/knowledge/knowledge-evidence-grounding";
import {
  hasSubstantiveSourceEvidence,
  isNonEvidenceExtractionText,
} from "@/lib/knowledge/knowledge-extraction-usability";
import {
  isGenerativeVisionExtraction,
  sourceBlocksOrganizeForVisionReview,
} from "@/lib/knowledge/knowledge-vision-integrity";

export const KNOWLEDGE_AI_INPUT_MAX_CHARS = 60_000;

function organizerError(code: string, message: string, status = 400) {
  return new KnowledgeServiceError(code, message, status);
}

function mockOrganization(
  source: Pick<KnowledgeSourceDetail, "sourceTitle" | "rawText">,
): KnowledgeAiOrganizationOutput {
  const text = source.rawText?.trim() ?? "";
  const firstLine = text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  const title =
    source.sourceTitle?.trim() ||
    firstLine.replace(/^#+\s*/, "").slice(0, 200) ||
    "Knowledge 来源整理草稿";
  const summaryLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
  const body = text;
  const completeness = assessOrganizerOutputCompleteness(source.rawText ?? "", {
    title,
    summary: summaryLines.join(" "),
    body,
    suggestedCategory: null,
    warnings: [],
  });
  const warnings = completeness.requiresHumanReview
    ? ["需要人工确认", ...completeness.missingAnchors.map((a) => `缺少来源事实：${a}`)]
    : [];
  return {
    title,
    summary: summaryLines.join("\n").slice(0, 400),
    body,
    suggestedCategory: null,
    warnings: warnings.length > 0 ? warnings : ["資訊不足 / 需要人工補充"],
  };
}

function failureCodeFor(error: unknown): string {
  if (error instanceof KnowledgeServiceError) return error.errorCode;
  if (error instanceof KnowledgeAiProviderOutputError) {
    return KNOWLEDGE_ERROR_CODES.AI_OUTPUT_INVALID;
  }
  if (error instanceof AiProviderError) {
    return KNOWLEDGE_ERROR_CODES.AI_ORGANIZATION_FAILED;
  }
  return KNOWLEDGE_ERROR_CODES.AI_ORGANIZATION_FAILED;
}

async function getActiveRun(sourceId: string, db: Database) {
  return (
    await db
      .select()
      .from(schema.knowledgeAiOrganizationRuns)
      .where(
        and(
          eq(schema.knowledgeAiOrganizationRuns.sourceId, sourceId),
          inArray(schema.knowledgeAiOrganizationRuns.status, [
            "pending",
            "processing",
          ]),
        ),
      )
      .limit(1)
  )[0] ?? null;
}

export async function organizeKnowledgeSource(
  context: KnowledgeSessionContext,
  sourceId: string,
  meta: KnowledgeSourceMeta,
  db: Database = getDb(),
): Promise<KnowledgeSourceDetail> {
  const source = await getKnowledgeSource(context, sourceId, db);
  if (!source.rawText) {
    throw organizerError(
      KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_UNAVAILABLE,
      "此来源没有可整理的文字内容",
    );
  }
  if (
    isNonEvidenceExtractionText(source.rawText) ||
    !hasSubstantiveSourceEvidence(source.rawText)
  ) {
    throw organizerError(
      KNOWLEDGE_ERROR_CODES.EXTRACTION_NEEDS_REVIEW,
      "来源文字不可用，无法作为 Knowledge 证据整理",
    );
  }
  if (source.rawText.length > KNOWLEDGE_AI_INPUT_MAX_CHARS) {
    throw organizerError(
      KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
      "来源文字超过 AI 整理的安全长度限制，请先分割来源",
    );
  }
  if (
    sourceBlocksOrganizeForVisionReview({
      extractionMethod: source.extractionMethod,
      extractionMetadata: source.extractionMetadata,
      rawText: source.rawText,
    })
  ) {
    throw organizerError(
      KNOWLEDGE_ERROR_CODES.EXTRACTION_NEEDS_REVIEW,
      "图片提取尚未通过人工确认，请先核对并确认转录内容后再整理",
    );
  }
  const extractionReliability = assessVisionExtractionReliability({
    rawText: source.rawText,
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
  if (await getActiveRun(sourceId, db)) {
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
      requestedByUserId: context.user.id,
      status: "pending",
      provider: null,
      model: null,
      proposedTitle: null,
      proposedSummary: null,
      proposedBody: null,
      proposedCategory: null,
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

    let output: KnowledgeAiOrganizationOutput;
    if (allowMockDeepInsightGeneration()) {
      provider = "mock";
      model = "mock-knowledge-organizer-v1";
      output = mockOrganization(source);
    } else {
      const settings = await getEffectiveAiSettings(db);
      provider = KNOWLEDGE_CLOUDFLARE_AI_PROVIDER;
      model = KNOWLEDGE_CLOUDFLARE_AI_MODEL;
      const rawOutput = await callKnowledgeOrganizationProvider({
        locale: settings.aiAnalysisLanguage,
        systemPrompt: buildKnowledgeOrganizerSystemPrompt(
          settings.aiAnalysisLanguage,
        ),
        userPrompt: buildKnowledgeOrganizerUserPrompt({
          sourceTitle: source.sourceTitle,
          sourceType: source.sourceType,
          text: source.rawText!,
        }),
      });
      const parsed = parseKnowledgeAiOrganizationOutput(rawOutput);
      if (!parsed.success) {
        throw organizerError(
          KNOWLEDGE_ERROR_CODES.AI_OUTPUT_INVALID,
          "AI 整理结果格式无效",
        );
      }
      output = parsed.data;
      const grounding = validateOrganizerEvidenceGrounding(source.rawText!, output);
      if (!grounding.ok) {
        throw organizerError(
          KNOWLEDGE_ERROR_CODES.ORGANIZATION_UNGROUNDED,
          "AI 整理结果包含来源中不存在的事实，需要人工确认",
        );
      }
      const completeness = assessOrganizerOutputCompleteness(
        source.rawText!,
        output,
      );
      if (!completeness.ok) {
        output = {
          ...output,
          warnings: [
            "需要人工确认",
            ...completeness.missingAnchors.map(
              (anchor) => `整理结果缺少来源事实：${anchor}`,
            ),
            ...output.warnings,
          ],
        };
      }
    }

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
