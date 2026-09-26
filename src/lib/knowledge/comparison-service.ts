import { candidateConflict, currentCandidateCondition, currentCandidateOrganizationCondition, requireCurrentCandidate } from "@/lib/knowledge/knowledge-candidate-guards";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
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
  retrieveComparisonCandidatesForSegment,
  type ComparisonCandidate,
} from "@/lib/knowledge/comparison-candidate-retrieval";
import { normalizeComparedOrganizerDraft } from "@/lib/knowledge/knowledge-candidate-comparison-draft";
import {
  getKnowledgeSegmentCandidate,
} from "@/lib/knowledge/knowledge-segment-candidate-service";
import { latestCandidateOrganization } from "@/lib/knowledge/knowledge-organization-run-queries";
import { hasUsableComparedOrganizerDraft } from "@/lib/knowledge/knowledge-candidate-comparison-draft";
import { redactKnowledgeComparisonForActor } from "@/lib/knowledge/comparison-visibility";
import {
  requireManageableKnowledgeSource,
  requireViewableKnowledgeSource,
  type KnowledgeSourceMeta,
} from "@/lib/knowledge/source-service";
import { buildKnowledgeAuditInsert, buildKnowledgeAuditInsertWhere, writeKnowledgeAudit } from "@/lib/knowledge/audit";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";
import type { KnowledgeAiComparisonRun } from "../../../drizzle/schema/knowledge-ai-comparison-runs";
import type { KnowledgeAiOrganizationRun } from "../../../drizzle/schema/knowledge-ai-organization-runs";
import {
  buildKnowledgeComparisonPreviewMock,
  shouldUseKnowledgeComparisonPreviewMock,
} from "@/lib/knowledge/knowledge-comparison-preview-mock";
import type {
  ComparisonCandidateSnapshot,
  KnowledgeComparisonDetail,
} from "@/lib/knowledge/comparison-types";
import {
  assertSourceLevelComparisonAllowed,
  loadSmartIngestSourceScope,
} from "@/lib/knowledge/smart-ingest-source-scope";

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

async function getActiveSourceComparisonRun(sourceId: string, db: Database) {
  return (
    await db
      .select()
      .from(schema.knowledgeAiComparisonRuns)
      .where(
        and(
          eq(schema.knowledgeAiComparisonRuns.sourceId, sourceId),
          isNull(schema.knowledgeAiComparisonRuns.candidateId),
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
        isNull(schema.knowledgeAiOrganizationRuns.candidateId),
        eq(schema.knowledgeAiOrganizationRuns.status, "completed"),
      ),
    )
    .orderBy(desc(schema.knowledgeAiOrganizationRuns.createdAt))
    .limit(1);
  return runs[0] ?? null;
}

async function latestSourceComparison(
  sourceId: string,
  db: Database,
): Promise<KnowledgeAiComparisonRun | null> {
  return (
    await db
      .select()
      .from(schema.knowledgeAiComparisonRuns)
      .where(
        and(
          eq(schema.knowledgeAiComparisonRuns.sourceId, sourceId),
          isNull(schema.knowledgeAiComparisonRuns.candidateId),
        ),
      )
      .orderBy(desc(schema.knowledgeAiComparisonRuns.createdAt), sql`knowledge_ai_comparison_runs.rowid DESC`)
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

export function mapComparisonRun(
  run: KnowledgeAiComparisonRun,
): KnowledgeComparisonDetail {
  return {
    id: run.id,
    sourceId: run.sourceId,
    candidateId: run.candidateId,
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
  const run = await latestSourceComparison(sourceId, db);
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
  const smartIngestScope = await loadSmartIngestSourceScope(
    sourceId,
    source.analysisStatus,
    db,
  );
  assertSourceLevelComparisonAllowed(smartIngestScope);
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
  if (await getActiveSourceComparisonRun(sourceId, db)) {
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

  return executeKnowledgeComparison({
    context,
    sourceId,
    candidateId: null,
    organizationRun,
    organizedContent: {
      title: organizationRun.proposedTitle!,
      summary: organizationRun.proposedSummary,
      body: organizationRun.proposedBody!,
    },
    candidates,
    meta,
    db,
    providerCall: dependencies.providerCall,
  });
}

async function getActiveCandidateComparisonRun(
  candidateId: string,
  db: Database,
) {
  return (
    await db
      .select()
      .from(schema.knowledgeAiComparisonRuns)
      .where(
        and(
          eq(schema.knowledgeAiComparisonRuns.candidateId, candidateId),
          inArray(schema.knowledgeAiComparisonRuns.status, [
            "pending",
            "processing",
          ]),
        ),
      )
      .limit(1)
  )[0] ?? null;
}

export async function latestCandidateComparison(
  candidateId: string,
  db: Database = getDb(),
): Promise<KnowledgeAiComparisonRun | null> {
  return (
    await db
      .select()
      .from(schema.knowledgeAiComparisonRuns)
      .where(eq(schema.knowledgeAiComparisonRuns.candidateId, candidateId))
      .orderBy(desc(schema.knowledgeAiComparisonRuns.createdAt), sql`knowledge_ai_comparison_runs.rowid DESC`)
      .limit(1)
  )[0] ?? null;
}

export async function getLatestKnowledgeSegmentCandidateComparison(
  context: KnowledgeSessionContext,
  sourceId: string,
  candidateId: string,
  db: Database = getDb(),
): Promise<KnowledgeComparisonDetail | null> {
  await requireViewableKnowledgeSource(context, sourceId, db);
  const run = await latestCandidateComparison(candidateId, db);
  if (!run || run.sourceId !== sourceId) return null;
  return redactKnowledgeComparisonForActor(
    context,
    mapComparisonRun(run),
    db,
  );
}

type ExecuteKnowledgeComparisonInput = {
  context: KnowledgeSessionContext;
  sourceId: string;
  candidateId: string | null;
  organizationRun: KnowledgeAiOrganizationRun;
  organizedContent: {
    title: string;
    summary: string | null;
    body: string;
  };
  comparedOrganizerDraft?: {
    title: string;
    summary: string;
    body: string;
  };
  candidates: ComparisonCandidate[];
  meta: KnowledgeSourceMeta;
  db: Database;
  providerCall?: KnowledgeComparisonProviderCall;
  commitCondition?: SQL;
};

async function executeKnowledgeComparison(
  input: ExecuteKnowledgeComparisonInput,
): Promise<KnowledgeComparisonDetail> {
  const {
    context,
    sourceId,
    candidateId,
    organizationRun,
    organizedContent,
    comparedOrganizerDraft,
    candidates,
    meta,
    db,
    providerCall,
  } = input;

  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const snapshot = toCandidateSnapshot(candidates);
  const commitCondition = input.commitCondition ?? sql`1 = 1`;
  const completedCondition = sql`EXISTS (SELECT 1 FROM knowledge_ai_comparison_runs
    WHERE id = ${runId} AND status = 'completed')`;

  try {
    await db.insert(schema.knowledgeAiComparisonRuns).select(sql`
      SELECT ${runId}, ${sourceId}, ${candidateId}, ${organizationRun.id}, ${context.user.id},
        'pending', NULL, NULL, NULL, NULL, NULL, ${JSON.stringify(snapshot)},
        NULL, NULL, NULL, NULL, NULL, ${now}, NULL
      WHERE ${commitCondition}
    `);
  } catch {
    throw comparisonError(
      KNOWLEDGE_ERROR_CODES.AI_COMPARISON_RUN_CONFLICT,
      "此来源已有进行中的 AI 比对",
      409,
    );
  }

  if (!(await db.select().from(schema.knowledgeAiComparisonRuns)
    .where(eq(schema.knowledgeAiComparisonRuns.id, runId)).limit(1))[0]) throw candidateConflict();

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
    const comparison: KnowledgeComparisonStoredResult = {
      ...emptyNoMatchComparisonResult(),
      ...(comparedOrganizerDraft
        ? { comparedOrganizerDraft }
        : {}),
    };
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
        .where(and(eq(schema.knowledgeAiComparisonRuns.id, runId), commitCondition)),
      buildKnowledgeAuditInsertWhere(db, {
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
      }, completedCondition),
    ]);
    const run = (
      await db
        .select()
        .from(schema.knowledgeAiComparisonRuns)
        .where(eq(schema.knowledgeAiComparisonRuns.id, runId))
        .limit(1)
    )[0];
    if (run?.status !== "completed") {
      await db.update(schema.knowledgeAiComparisonRuns)
        .set({ status: "failed", failureCode: KNOWLEDGE_ERROR_CODES.AI_COMPARISON_STALE, completedAt })
        .where(eq(schema.knowledgeAiComparisonRuns.id, runId));
      throw candidateConflict();
    }
    return mapComparisonRun(run);
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
        organizedTitle: organizedContent.title,
        organizedSummary: organizedContent.summary,
        organizedBody: organizedContent.body,
        candidates,
      },
    );
    const promptCandidates = promptBudget.candidates;
    const allowedKeys = new Set(
      promptCandidates.map((candidate) => candidate.candidateKey),
    );

    let output: KnowledgeAiComparisonOutput;
    if (providerCall) {
      provider = "test";
      model = "test-knowledge-compare";
      const rawOutput = await providerCall({
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
      output = shouldUseKnowledgeComparisonPreviewMock(
        organizedContent.body,
        promptCandidates,
      )
        ? buildKnowledgeComparisonPreviewMock(promptCandidates)
        : mockComparisonOutput(promptCandidates);
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
      ...(comparedOrganizerDraft ? { comparedOrganizerDraft } : {}),
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
        .where(and(eq(schema.knowledgeAiComparisonRuns.id, runId), commitCondition)),
      buildKnowledgeAuditInsertWhere(db, {
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
      }, completedCondition),
    ]);
    const completed = (await db.select().from(schema.knowledgeAiComparisonRuns)
      .where(eq(schema.knowledgeAiComparisonRuns.id, runId)).limit(1))[0];
    if (completed?.status !== "completed") throw candidateConflict();
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

export async function compareKnowledgeSegmentCandidate(
  context: KnowledgeSessionContext,
  sourceId: string,
  candidateId: string,
  draftInput: { title: string; summary: string; body: string; organizationRunId?: string | null },
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
  const authoritative = await requireCurrentCandidate(context, sourceId, candidateId, db);
  if (authoritative.draftArticleId) throw candidateConflict();
  const candidate = await getKnowledgeSegmentCandidate(
    context,
    sourceId,
    candidateId,
    db,
  );
  if (!candidate || candidate.status === "superseded") {
    throw comparisonError(
      KNOWLEDGE_ERROR_CODES.SOURCE_NOT_FOUND,
      "主题候选不存在",
      404,
    );
  }
  const draft = normalizeComparedOrganizerDraft(draftInput);
  if (!hasUsableComparedOrganizerDraft(draft)) {
    throw comparisonError(
      KNOWLEDGE_ERROR_CODES.AI_ORGANIZATION_REQUIRED,
      "请先完成独立整理",
      409,
    );
  }
  const organizationRun = await latestCandidateOrganization(candidateId, db);
  if (
    !organizationRun ||
    organizationRun.status !== "completed" ||
    organizationRun.candidateId !== candidateId || organizationRun.sourceId !== sourceId
  ) {
    throw comparisonError(
      KNOWLEDGE_ERROR_CODES.AI_ORGANIZATION_REQUIRED,
      "没有可供比对的 AI 整理结果",
      409,
    );
  }
  if (draftInput.organizationRunId !== organizationRun.id) {
    throw comparisonError(KNOWLEDGE_ERROR_CODES.AI_COMPARISON_STALE, "整理结果已变更，请刷新后重新比较", 409);
  }
  if (await getActiveCandidateComparisonRun(candidateId, db)) {
    throw comparisonError(
      KNOWLEDGE_ERROR_CODES.AI_COMPARISON_RUN_CONFLICT,
      "此主题已有进行中的 AI 比对",
      409,
    );
  }

  const categoryName = organizationRun.proposedCategory ?? null;

  const candidates =
    dependencies.candidates ??
    (await retrieveComparisonCandidatesForSegment(
      context,
      {
        segmentTitleHint: candidate.segmentTitleHint,
        evidenceText: candidate.segmentEvidenceText,
        proposedTitle: draft.title,
        proposedSummary: draft.summary,
        proposedCategory: categoryName,
        proposedBody: draft.body,
      },
      db,
    ));

  return executeKnowledgeComparison({
    context,
    sourceId,
    candidateId,
    commitCondition: and(currentCandidateCondition(authoritative, context),
      currentCandidateOrganizationCondition(authoritative, organizationRun.id),
      sql`EXISTS (SELECT 1 FROM knowledge_source_segment_candidates
        WHERE id = ${candidateId} AND draft_article_id IS NULL)`),
    organizationRun,
    organizedContent: {
      title: draft.title,
      summary: draft.summary,
      body: draft.body,
    },
    comparedOrganizerDraft: draft,
    candidates,
    meta,
    db,
    providerCall: dependencies.providerCall,
  });
}
