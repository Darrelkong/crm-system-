import { and, count, eq, gte, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { AiConfigError, AiProviderError } from "@/lib/ai/customer-insights/errors";
import {
  allowMockDeepInsightGeneration,
  resolveCustomerInsightProvider,
} from "@/lib/ai/providers/factory";
import { getEffectiveAiSettings } from "@/lib/settings/ai-effective";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { buildKnowledgeAuditInsert } from "@/lib/knowledge/audit";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  buildKnowledgeQaSystemPrompt,
  buildKnowledgeQaUserPrompt,
} from "@/lib/knowledge/ai-qa-prompt";
import {
  KnowledgeAiProviderOutputError,
  KnowledgeAiProviderTimeoutError,
  callKnowledgeQaProvider,
} from "@/lib/knowledge/ai-qa-provider";
import {
  parseKnowledgeAiQaOutput,
  type KnowledgeAiQaOutput,
} from "@/lib/knowledge/ai-qa-schema";
import {
  KNOWLEDGE_AI_SOURCE_MAX,
  KNOWLEDGE_AI_SOURCE_TEXT_MAX_CHARS,
  normalizeKnowledgeQuery,
  retrievePublishedKnowledge,
  type PublishedKnowledgeDocument,
} from "@/lib/knowledge/published-retrieval";
import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";

export const KNOWLEDGE_AI_QUESTION_MAX_CHARS = 200;
export const KNOWLEDGE_AI_DEFAULT_DAILY_LIMIT = 20;

type KnowledgeQaProviderCall = (input: {
  kind: "openai_compatible" | "google_gemini";
  config: NonNullable<
    ReturnType<typeof resolveCustomerInsightProvider>["config"]
  >;
  systemPrompt: string;
  userPrompt: string;
}) => Promise<unknown>;

export type KnowledgeAiCitation = {
  citationId: string;
  articleId: string;
  versionNumber: number;
  title: string;
  categoryName: string;
  href: string;
};

export type KnowledgeAiAnswer = {
  runId: string;
  answer: string;
  insufficientInformation: boolean;
  citations: KnowledgeAiCitation[];
  sourceCount: number;
};

function aiError(code: string, message: string, status = 400) {
  return new KnowledgeServiceError(code, message, status);
}

function dailyLimit(): number {
  const configured = Number(process.env.KNOWLEDGE_AI_DAILY_LIMIT);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, 100)
    : KNOWLEDGE_AI_DEFAULT_DAILY_LIMIT;
}

async function hashQuestion(question: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(question),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function reserveRun(
  context: KnowledgeSessionContext,
  question: string,
  db: Database,
) {
  const active = await db
    .select({ id: schema.knowledgeAiQueryRuns.id })
    .from(schema.knowledgeAiQueryRuns)
    .where(
      and(
        eq(schema.knowledgeAiQueryRuns.userId, context.user.id),
        inArray(schema.knowledgeAiQueryRuns.status, ["pending", "processing"]),
      ),
    )
    .limit(1);
  if (active.length > 0) {
    throw aiError(
      KNOWLEDGE_ERROR_CODES.AI_BUSY,
      "已有一项 Knowledge AI 请求处理中，请稍候",
      409,
    );
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recent = await db
    .select({ count: count() })
    .from(schema.knowledgeAiQueryRuns)
    .where(
      and(
        eq(schema.knowledgeAiQueryRuns.userId, context.user.id),
        gte(schema.knowledgeAiQueryRuns.createdAt, since),
      ),
    );
  if (Number(recent[0]?.count ?? 0) >= dailyLimit()) {
    throw aiError(
      KNOWLEDGE_ERROR_CODES.AI_RATE_LIMITED,
      "Knowledge AI 今日使用次数已达上限，请稍后再试",
      429,
    );
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db.batch([
      db.insert(schema.knowledgeAiQueryRuns).values({
        id,
        userId: context.user.id,
        status: "processing",
        queryHash: await hashQuestion(question),
        queryLength: question.length,
        retrievedSourceCount: 0,
        provider: null,
        model: null,
        startedAt: now,
        completedAt: null,
        failureCode: null,
        createdAt: now,
      }),
      buildKnowledgeAuditInsert(db, {
        userId: context.user.id,
        action: "knowledge_ai_question_started",
        entityType: "knowledge_ai_query_run",
        entityId: id,
        metadata: { status: "processing", queryLength: question.length },
      }),
    ]);
  } catch {
    throw aiError(
      KNOWLEDGE_ERROR_CODES.AI_BUSY,
      "已有一项 Knowledge AI 请求处理中，请稍候",
      409,
    );
  }
  return { id, startedAt: now };
}

async function finishRun(
  context: KnowledgeSessionContext,
  runId: string,
  values: {
    status: "completed" | "failed";
    sourceCount: number;
    provider?: string | null;
    model?: string | null;
    failureCode?: string | null;
  },
  db: Database,
) {
  const completedAt = new Date().toISOString();
  const action =
    values.status === "completed"
      ? "knowledge_ai_question_completed"
      : "knowledge_ai_question_failed";
  await db.batch([
    db
      .update(schema.knowledgeAiQueryRuns)
      .set({
        status: values.status,
        retrievedSourceCount: values.sourceCount,
        provider: values.provider ?? null,
        model: values.model ?? null,
        completedAt,
        failureCode: values.failureCode ?? null,
      })
      .where(
        and(
          eq(schema.knowledgeAiQueryRuns.id, runId),
          eq(schema.knowledgeAiQueryRuns.userId, context.user.id),
          eq(schema.knowledgeAiQueryRuns.status, "processing"),
        ),
      ),
    buildKnowledgeAuditInsert(db, {
      userId: context.user.id,
      action,
      entityType: "knowledge_ai_query_run",
      entityId: runId,
      metadata: {
        status: values.status,
        sourceCount: values.sourceCount,
        provider: values.provider ?? null,
        model: values.model ?? null,
        failureCode: values.failureCode ?? null,
      },
    }),
  ]);
}

function mockAnswer(documents: PublishedKnowledgeDocument[]): KnowledgeAiQaOutput {
  const answer = documents
    .map(
      (document) =>
        `${document.title}：${(document.summary ?? document.body).slice(0, 700)}`,
    )
    .join("\n");
  return {
    answer: answer || "目前 Knowledge 中沒有足夠資料回答這個問題。",
    citationIds: documents.map((document) => document.citationId),
    insufficientInformation: documents.length === 0,
  };
}

function validateAnswer(
  rawOutput: unknown,
  documents: PublishedKnowledgeDocument[],
): KnowledgeAiQaOutput {
  const parsed = parseKnowledgeAiQaOutput(rawOutput);
  if (!parsed.success) {
    throw aiError(
      KNOWLEDGE_ERROR_CODES.AI_QA_OUTPUT_INVALID,
      "Knowledge AI 回覆格式无效",
    );
  }
  const allowed = new Set(documents.map((document) => document.citationId));
  const citationIds = Array.from(new Set(parsed.data.citationIds));
  if (
    citationIds.some((citationId) => !allowed.has(citationId)) ||
    (!parsed.data.insufficientInformation && citationIds.length === 0)
  ) {
    throw aiError(
      KNOWLEDGE_ERROR_CODES.AI_CITATION_INVALID,
      "Knowledge AI 回覆引用无效",
    );
  }
  return { ...parsed.data, citationIds };
}

function citationsFor(
  output: KnowledgeAiQaOutput,
  documents: PublishedKnowledgeDocument[],
): KnowledgeAiCitation[] {
  const byId = new Map(documents.map((document) => [document.citationId, document]));
  return output.citationIds.map((citationId) => {
    const document = byId.get(citationId);
    if (!document) {
      throw aiError(
        KNOWLEDGE_ERROR_CODES.AI_CITATION_INVALID,
        "Knowledge AI 回覆引用无效",
      );
    }
    return {
      citationId,
      articleId: document.articleId,
      versionNumber: document.versionNumber,
      title: document.title,
      categoryName: document.categoryName,
      href: `/knowledge/articles/${document.articleId}/history?version=${document.versionNumber}`,
    };
  });
}

function mapProviderError(error: unknown): KnowledgeServiceError {
  if (error instanceof KnowledgeServiceError) return error;
  if (error instanceof KnowledgeAiProviderOutputError) {
    return aiError(
      KNOWLEDGE_ERROR_CODES.AI_QA_OUTPUT_INVALID,
      "Knowledge AI 回覆格式无效",
    );
  }
  if (error instanceof KnowledgeAiProviderTimeoutError) {
    return aiError(
      KNOWLEDGE_ERROR_CODES.AI_TIMEOUT,
      "Knowledge AI 请求超时，请稍后再试",
      504,
    );
  }
  if (error instanceof AiConfigError || error instanceof AiProviderError) {
    return aiError(
      KNOWLEDGE_ERROR_CODES.AI_PROVIDER_FAILED,
      "Knowledge AI 暂时无法使用，请稍后再试",
      503,
    );
  }
  return aiError(
    KNOWLEDGE_ERROR_CODES.AI_PROVIDER_FAILED,
    "Knowledge AI 暂时无法使用，请稍后再试",
    503,
  );
}

export async function askKnowledge(
  context: KnowledgeSessionContext,
  question: unknown,
  db: Database = getDb(),
  dependencies: {
    providerCall?: KnowledgeQaProviderCall;
  } = {},
): Promise<KnowledgeAiAnswer> {
  const normalizedQuestion = normalizeKnowledgeQuery(question);
  if (normalizedQuestion.length > KNOWLEDGE_AI_QUESTION_MAX_CHARS) {
    throw aiError(KNOWLEDGE_ERROR_CODES.SEARCH_INVALID, "问题长度无效");
  }
  const run = await reserveRun(context, normalizedQuestion, db);
  let providerName: string | null = null;
  let modelName: string | null = null;
  try {
    const documents = await retrievePublishedKnowledge(
      context,
      normalizedQuestion,
      { limit: KNOWLEDGE_AI_SOURCE_MAX, maxBodyChars: KNOWLEDGE_AI_SOURCE_TEXT_MAX_CHARS },
      db,
    );
    if (documents.length === 0) {
      await finishRun(context, run.id, {
        status: "failed",
        sourceCount: 0,
        failureCode: KNOWLEDGE_ERROR_CODES.AI_NO_SOURCES,
      }, db);
      return {
        runId: run.id,
        answer: "目前 Knowledge 中沒有足夠資料回答這個問題。",
        insufficientInformation: true,
        citations: [],
        sourceCount: 0,
      };
    }
    const settings = await getEffectiveAiSettings(db);
    const resolved = resolveCustomerInsightProvider(settings);
    providerName = resolved.kind;
    modelName = resolved.model;
    let rawOutput: unknown;
    if (resolved.kind === "mock") {
      if (!allowMockDeepInsightGeneration() && !dependencies.providerCall) {
        throw aiError(
          KNOWLEDGE_ERROR_CODES.AI_PROVIDER_FAILED,
          "Knowledge AI 暂时无法使用，请稍后再试",
          503,
        );
      }
      rawOutput = dependencies.providerCall
        ? await dependencies.providerCall({
            kind: "openai_compatible",
            config: {
              apiBaseUrl: "",
              model: "test",
              temperature: 0,
              maxTokens: 1024,
              timeoutMs: 5_000,
              apiKey: "test",
            },
            systemPrompt: buildKnowledgeQaSystemPrompt(settings.aiAnalysisLanguage),
            userPrompt: buildKnowledgeQaUserPrompt(normalizedQuestion, documents),
          })
        : mockAnswer(documents);
    } else {
      if (!resolved.config) {
        throw aiError(
          KNOWLEDGE_ERROR_CODES.AI_PROVIDER_FAILED,
          "Knowledge AI 暂时无法使用，请稍后再试",
          503,
        );
      }
      rawOutput = await (dependencies.providerCall ?? callKnowledgeQaProvider)({
        kind: resolved.kind,
        config: resolved.config,
        systemPrompt: buildKnowledgeQaSystemPrompt(settings.aiAnalysisLanguage),
        userPrompt: buildKnowledgeQaUserPrompt(normalizedQuestion, documents),
      });
    }
    const output = validateAnswer(rawOutput, documents);
    const citations = citationsFor(output, documents);
    await finishRun(context, run.id, {
      status: "completed",
      sourceCount: documents.length,
      provider: providerName,
      model: modelName,
    }, db);
    return {
      runId: run.id,
      answer: output.answer,
      insufficientInformation: output.insufficientInformation,
      citations,
      sourceCount: documents.length,
    };
  } catch (error) {
    const mapped = mapProviderError(error);
    await finishRun(context, run.id, {
      status: "failed",
      sourceCount: 0,
      provider: providerName,
      model: modelName,
      failureCode: mapped.errorCode,
    }, db);
    throw mapped;
  }
}
