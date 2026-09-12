import { and, desc, eq, inArray } from "drizzle-orm";
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
  buildKnowledgeComparisonPromptBudget,
} from "@/lib/knowledge/ai-comparison-prompt";
import {
  emptyNoMatchComparisonResult,
  parseKnowledgeAiComparisonOutput,
  type KnowledgeAiComparisonOutput,
  type KnowledgeComparisonStoredResult,
} from "@/lib/knowledge/ai-comparison-schema";
import {
  callKnowledgeComparisonProvider,
  KnowledgeAiComparisonOutputError,
  KnowledgeAiComparisonTimeoutError,
} from "@/lib/knowledge/ai-comparison-provider";
import {
  retrieveComparisonCandidates,
  type ComparisonCandidate,
} from "@/lib/knowledge/comparison-candidate-retrieval";
import { redactKnowledgeComparisonForActor } from "@/lib/knowledge/comparison-visibility";
import {
  requireManageableKnowledgeSource,
  requireViewableKnowledgeSource,
  type KnowledgeSourceMeta,
} from "@/lib/knowledge/source-service";
import { buildKnowledgeAuditInsert, writeKnowledgeAudit } from "@/lib/knowledge/audit";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";
import type { KnowledgeAiComparisonRun } from "../../../drizzle/schema/knowledge-ai-comparison-runs";
import type { KnowledgeAiOrganizationRun } from "../../../drizzle/schema/knowledge-ai-organization-runs";
import type {
  ComparisonCandidateSnapshot,
  KnowledgeComparisonDetail,
} from "@/lib/knowledge/comparison-types";

export type {
  ComparisonCandidateSnapshot,
  KnowledgeComparisonDetail,
} from "@/lib/knowledge/comparison-types";

function comparisonError(code: string, message: string, status = 400) {
  return new KnowledgeServiceError(code, message, status);
}

function failureCodeFor(error: unknown): string {
  if (error instanceof KnowledgeServiceError) return error.errorCode;
  if (error instanceof KnowledgeAiComparisonOutputError) {
    return KNOWLEDGE_ERROR_CODES.AI_COMPARISON_OUTPUT_INVALID;
  }
  if (error instanceof KnowledgeAiComparisonTimeoutError) {
    return KNOWLEDGE_ERROR_CODES.AI_TIMEOUT;
  }
  if (error instanceof AiProviderError) {
    return KNOWLEDGE_ERROR_CODES.AI_COMPARISON_FAILED;
  }
  return KNOWLEDGE_ERROR_CODES.AI_COMPARISON_FAILED;
}

async function getActiveComparisonRun(sourceId: string, db: Database) {
  return (
    await db
      .select()
      .from(schema.knowledgeAiComparisonRuns)
      .where(
        and(
          eq(schema.knowledgeAiComparisonRuns.sourceId, sourceId),
          inArray(schema.knowledgeAiComparisonRuns.status, [
            "pending",
            "processing",
          ]),
        ),
      )
      .limit(1)
  )[0] ?? null;
}

async function latestCompletedOrganization(
  sourceId: string,
  db: Database,
): Promise<KnowledgeAiOrganizationRun | null> {
  const runs = await db
    .select()
    .from(schema.knowledgeAiOrganizationRuns)
    .where(
      and(
        eq(schema.knowledgeAiOrganizationRuns.sourceId, sourceId),
        eq(schema.knowledgeAiOrganizationRuns.status, "completed"),
      ),
    )
    .orderBy(desc(schema.knowledgeAiOrganizationRuns.createdAt))
    .limit(1);
  return runs[0] ?? null;
}

async function latestComparison(
  sourceId: string,
  db: Database,
): Promise<KnowledgeAiComparisonRun | null> {
  return (
    await db
      .select()
      .from(schema.knowledgeAiComparisonRuns)
      .where(eq(schema.knowledgeAiComparisonRuns.sourceId, sourceId))
      .orderBy(desc(schema.knowledgeAiComparisonRuns.createdAt))
      .limit(1)
  )[0] ?? null;
}

function toCandidateSnapshot(
  candidates: ComparisonCandidate[],
): ComparisonCandidateSnapshot[] {
  return candidates.map((candidate) => ({
    candidateKey: candidate.candidateKey,
    articleId: candidate.articleId,
    articleVersionId: candidate.articleVersionId,
    versionNumber: candidate.versionNumber,
    title: candidate.title,
    categoryName: candidate.categoryName,
    preRank: candidate.preRank,
    preScore: candidate.preScore,
    postRank: candidate.postRank,
    postScore: candidate.postScore,
    combinedScore: candidate.combinedScore,
    bodyExcerptStart: candidate.bodyExcerptStart,
    bodyExcerptEnd: candidate.bodyExcerptEnd,
  }));
}

function parseCandidateSnapshot(value: string): ComparisonCandidateSnapshot[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ComparisonCandidateSnapshot =>
        !!item &&
        typeof item === "object" &&
        typeof (item as ComparisonCandidateSnapshot).candidateKey === "string",
    );
  } catch {
    return [];
  }
}

function parseStoredComparison(
  value: string | null,
): KnowledgeComparisonStoredResult | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as KnowledgeComparisonStoredResult;
  } catch {
    return null;
  }
}

function mapComparisonRun(
  run: KnowledgeAiComparisonRun,
): KnowledgeComparisonDetail {
  return {
    id: run.id,
    sourceId: run.sourceId,
    organizationRunId: run.organizationRunId,
    status: run.status,
    relationship: run.relationship,
    matchedArticleId: run.matchedArticleId,
    matchedArticleVersionId: run.matchedArticleVersionId,
    matchedVersionNumber: run.matchedVersionNumber,
    matchConfidence: run.matchConfidence,
    candidateSnapshot: parseCandidateSnapshot(run.candidateSnapshotJson),
    comparison: parseStoredComparison(run.comparisonJson),
    degradationLevel: run.degradationLevel,
    provider: run.provider,
    model: run.model,
    failureCode: run.failureCode,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  };
}

function validateCandidateKey(
  output: KnowledgeAiComparisonOutput,
  allowedKeys: Set<string>,
): void {
  if (
    output.matchedCandidateKey !== null &&
    !allowedKeys.has(output.matchedCandidateKey)
  ) {
    throw comparisonError(
      KNOWLEDGE_ERROR_CODES.AI_COMPARISON_CANDIDATE_INVALID,
      "AI 比对返回了无效候选键",
    );
  }
  if (
    output.relationship === "update_existing" &&
    output.matchedCandidateKey === null
  ) {
    throw comparisonError(
      KNOWLEDGE_ERROR_CODES.AI_COMPARISON_OUTPUT_INVALID,
      "AI 比对结果格式无效",
    );
  }
}

function resolveMatchedCandidate(
  output: KnowledgeAiComparisonOutput,
  candidates: ComparisonCandidate[],
): ComparisonCandidate | null {
  if (!output.matchedCandidateKey) return null;
  return (
    candidates.find(
      (candidate) => candidate.candidateKey === output.matchedCandidateKey,
    ) ?? null
  );
}

function mockComparisonOutput(
  candidates: ComparisonCandidate[],
): KnowledgeAiComparisonOutput {
  const primary = candidates[0];
  return {
    relationship: primary ? "update_existing" : "new_article",
    matchedCandidateKey: (primary?.candidateKey ?? null) as
      | "C1"
      | "C2"
      | "C3"
      | null,
    matchConfidence: primary ? 0.75 : 0.2,
    newFacts: [],
    changedFacts: [],
    conflicts: [],
    uncertainties: [],
    suggestedUpdates: [],
  };
}

export async function getLatestKnowledgeComparison(
  context: KnowledgeSessionContext,
  sourceId: string,
  db: Database = getDb(),
): Promise<KnowledgeComparisonDetail | null> {
  await requireViewableKnowledgeSource(context, sourceId, db);
  const run = await latestComparison(sourceId, db);
  if (!run) return null;
  return redactKnowledgeComparisonForActor(
    context,
    mapComparisonRun(run),
    db,
  );
}

type KnowledgeComparisonProviderCall = (input: {
  locale: string;
  systemPrompt: string;
  userPrompt: string;
}) => Promise<unknown>;

export async function compareKnowledgeSource(
  context: KnowledgeSessionContext,
  sourceId: string,
  meta: KnowledgeSourceMeta,
  db: Database = getDb(),
  dependencies: {
    providerCall?: KnowledgeComparisonProviderCall;
    candidates?: ComparisonCandidate[];
  } = {},
): Promise<KnowledgeComparisonDetail> {
  const source = await requireManageableKnowledgeSource(
    context,
    sourceId,
    db,
    "来源比对权限不足",
  );
  if (source.archivedAt) {
    throw comparisonError(
      KNOWLEDGE_ERROR_CODES.SOURCE_ARCHIVED,
      "已归档来源无法比对",
      409,
    );
  }
  if (source.status !== "organized") {
    throw comparisonError(
      KNOWLEDGE_ERROR_CODES.AI_ORGANIZATION_REQUIRED,
      "来源尚未完成 AI 整理",
      409,
    );
  }
  const organizationRun = await latestCompletedOrganization(sourceId, db);
  if (
    !organizationRun ||
    !organizationRun.proposedTitle ||
    !organizationRun.proposedBody
  ) {
    throw comparisonError(
      KNOWLEDGE_ERROR_CODES.AI_ORGANIZATION_REQUIRED,
      "没有可供比对的 AI 整理结果",
      409,
    );
  }
  if (await getActiveComparisonRun(sourceId, db)) {
    throw comparisonError(
      KNOWLEDGE_ERROR_CODES.AI_COMPARISON_RUN_CONFLICT,
      "此来源已有进行中的 AI 比对",
      409,
    );
  }

  const candidates =
    dependencies.candidates ??
    (await retrieveComparisonCandidates(
      context,
      {
        sourceTitle: source.sourceTitle,
        rawText: source.rawText ?? "",
        proposedTitle: organizationRun.proposedTitle,
        proposedSummary: organizationRun.proposedSummary,
        proposedCategory: organizationRun.proposedCategory,
        proposedBody: organizationRun.proposedBody,
      },
      db,
    ));

  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const snapshot = toCandidateSnapshot(candidates);

  try {
    await db.insert(schema.knowledgeAiComparisonRuns).values({
      id: runId,
      sourceId,
      organizationRunId: organizationRun.id,
      requestedByUserId: context.user.id,
      status: "pending",
      relationship: null,
      matchedArticleId: null,
      matchedArticleVersionId: null,
      matchedVersionNumber: null,
      matchConfidence: null,
      candidateSnapshotJson: JSON.stringify(snapshot),
      comparisonJson: null,
      degradationLevel: null,
      provider: null,
      model: null,
      failureCode: null,
      createdAt: now,
      completedAt: null,
    });
  } catch {
    throw comparisonError(
      KNOWLEDGE_ERROR_CODES.AI_COMPARISON_RUN_CONFLICT,
      "此来源已有进行中的 AI 比对",
      409,
    );
  }

  await writeKnowledgeAudit(
    {
      userId: context.user.id,
      action: "knowledge_comparison_started",
      entityType: "knowledge_ai_comparison_run",
      entityId: runId,
      ...meta,
      metadata: {
        sourceId,
        organizationRunId: organizationRun.id,
        candidateCount: candidates.length,
      },
    },
    db,
  );

  if (candidates.length === 0) {
    const comparison = emptyNoMatchComparisonResult();
    const completedAt = new Date().toISOString();
    await db.batch([
      db
        .update(schema.knowledgeAiComparisonRuns)
        .set({
          status: "completed",
          relationship: "no_match",
          matchedArticleId: null,
          matchedArticleVersionId: null,
          matchedVersionNumber: null,
          matchConfidence: null,
          comparisonJson: JSON.stringify(comparison),
          degradationLevel: null,
          provider: null,
          model: null,
          completedAt,
          failureCode: null,
        })
        .where(eq(schema.knowledgeAiComparisonRuns.id, runId)),
      buildKnowledgeAuditInsert(db, {
        userId: context.user.id,
        action: "knowledge_comparison_completed",
        entityType: "knowledge_ai_comparison_run",
        entityId: runId,
        ...meta,
        metadata: {
          sourceId,
          organizationRunId: organizationRun.id,
          relationship: "no_match",
          matchedArticleId: null,
          matchedArticleVersionId: null,
          candidateCount: 0,
          degradationLevel: null,
        },
      }),
    ]);
    const run = (
      await db
        .select()
        .from(schema.knowledgeAiComparisonRuns)
        .where(eq(schema.knowledgeAiComparisonRuns.id, runId))
        .limit(1)
    )[0];
    return mapComparisonRun(run!);
  }

  let provider = "unknown";
  let model = "unknown";
  try {
    await db
      .update(schema.knowledgeAiComparisonRuns)
      .set({ status: "processing" })
      .where(eq(schema.knowledgeAiComparisonRuns.id, runId));

    const settings = await getEffectiveAiSettings(db);
    const promptBudget = buildKnowledgeComparisonPromptBudget(
      settings.aiAnalysisLanguage,
      {
        organizedTitle: organizationRun.proposedTitle!,
        organizedSummary: organizationRun.proposedSummary,
        organizedBody: organizationRun.proposedBody!,
        candidates,
      },
    );
    const promptCandidates = promptBudget.candidates;
    const allowedKeys = new Set(
      promptCandidates.map((candidate) => candidate.candidateKey),
    );

    let output: KnowledgeAiComparisonOutput;
    if (dependencies.providerCall) {
      provider = "test";
      model = "test-knowledge-compare";
      const rawOutput = await dependencies.providerCall({
        locale: settings.aiAnalysisLanguage,
        systemPrompt: promptBudget.systemPrompt,
        userPrompt: promptBudget.userPrompt,
      });
      const parsed = parseKnowledgeAiComparisonOutput(rawOutput);
      if (!parsed.success) {
        throw comparisonError(
          KNOWLEDGE_ERROR_CODES.AI_COMPARISON_OUTPUT_INVALID,
          "AI 比对结果格式无效",
        );
      }
      output = parsed.data;
    } else if (allowMockDeepInsightGeneration()) {
      provider = "mock";
      model = "mock-knowledge-compare-v1";
      output = mockComparisonOutput(promptCandidates);
    } else {
      provider = KNOWLEDGE_CLOUDFLARE_AI_PROVIDER;
      model = KNOWLEDGE_CLOUDFLARE_AI_MODEL;
      const rawOutput = await callKnowledgeComparisonProvider({
        locale: settings.aiAnalysisLanguage,
        systemPrompt: promptBudget.systemPrompt,
        userPrompt: promptBudget.userPrompt,
      });
      const parsed = parseKnowledgeAiComparisonOutput(rawOutput);
      if (!parsed.success) {
        throw comparisonError(
          KNOWLEDGE_ERROR_CODES.AI_COMPARISON_OUTPUT_INVALID,
          "AI 比对结果格式无效",
        );
      }
      output = parsed.data;
    }

    validateCandidateKey(output, allowedKeys);
    const matched = resolveMatchedCandidate(output, promptCandidates);
    const storedComparison: KnowledgeComparisonStoredResult = {
      relationship: output.relationship,
      matchedCandidateKey: output.matchedCandidateKey,
      matchConfidence: output.matchConfidence,
      newFacts: output.newFacts,
      changedFacts: output.changedFacts,
      conflicts: output.conflicts,
      uncertainties: output.uncertainties,
      suggestedUpdates: output.suggestedUpdates,
      degradationLevel: promptBudget.degradationLevel,
    };
    const completedAt = new Date().toISOString();
    await db.batch([
      db
        .update(schema.knowledgeAiComparisonRuns)
        .set({
          status: "completed",
          relationship: output.relationship,
          matchedArticleId: matched?.articleId ?? null,
          matchedArticleVersionId: matched?.articleVersionId ?? null,
          matchedVersionNumber: matched?.versionNumber ?? null,
          matchConfidence: output.matchConfidence,
          candidateSnapshotJson: JSON.stringify(
            toCandidateSnapshot(promptCandidates),
          ),
          comparisonJson: JSON.stringify(storedComparison),
          degradationLevel: promptBudget.degradationLevel,
          provider,
          model,
          completedAt,
          failureCode: null,
        })
        .where(eq(schema.knowledgeAiComparisonRuns.id, runId)),
      buildKnowledgeAuditInsert(db, {
        userId: context.user.id,
        action: "knowledge_comparison_completed",
        entityType: "knowledge_ai_comparison_run",
        entityId: runId,
        ...meta,
        metadata: {
          sourceId,
          organizationRunId: organizationRun.id,
          relationship: output.relationship,
          matchedArticleId: matched?.articleId ?? null,
          matchedArticleVersionId: matched?.articleVersionId ?? null,
          candidateCount: promptCandidates.length,
          degradationLevel: promptBudget.degradationLevel,
        },
      }),
    ]);
  } catch (error) {
    const failureCode = failureCodeFor(error);
    const failureAt = new Date().toISOString();
    await db.batch([
      db
        .update(schema.knowledgeAiComparisonRuns)
        .set({
          status: "failed",
          provider,
          model,
          completedAt: failureAt,
          failureCode,
        })
        .where(eq(schema.knowledgeAiComparisonRuns.id, runId)),
      buildKnowledgeAuditInsert(db, {
        userId: context.user.id,
        action: "knowledge_comparison_failed",
        entityType: "knowledge_ai_comparison_run",
        entityId: runId,
        ...meta,
        metadata: {
          sourceId,
          organizationRunId: organizationRun.id,
          failureCode,
        },
      }),
    ]);
    throw error instanceof KnowledgeServiceError
      ? error
      : comparisonError(
          KNOWLEDGE_ERROR_CODES.AI_COMPARISON_FAILED,
          "AI 比对失败，请稍后再试",
          503,
        );
  }

  const run = (
    await db
      .select()
      .from(schema.knowledgeAiComparisonRuns)
      .where(eq(schema.knowledgeAiComparisonRuns.id, runId))
      .limit(1)
  )[0];
  return mapComparisonRun(run!);
}
