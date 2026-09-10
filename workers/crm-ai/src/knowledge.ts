import {
  KNOWLEDGE_MODEL,
  KNOWLEDGE_ORGANIZE_MAX_TOKENS,
  KNOWLEDGE_ORGANIZE_PROMPT_VERSION,
  KNOWLEDGE_ORGANIZE_TEMPERATURE,
  KNOWLEDGE_QA_MAX_TOKENS,
  KNOWLEDGE_QA_PROMPT_VERSION,
  KNOWLEDGE_QA_TEMPERATURE,
} from "./models";
import type {
  AiServiceError,
  AiServiceResult,
  CrmAiKnowledgeOrganizeRequest,
  CrmAiKnowledgeQaRequest,
  CrmAiEnv,
  KnowledgeOrganizeOutput,
  KnowledgeQaOutput,
} from "./types";

export const KNOWLEDGE_ORGANIZATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "body", "suggestedCategory", "warnings"],
  properties: {
    title: { type: "string" },
    summary: { type: ["string", "null"] },
    body: { type: "string" },
    suggestedCategory: { type: ["string", "null"] },
    warnings: { type: "array", items: { type: "string" } },
  },
} as const;

export const KNOWLEDGE_QA_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "citationIds", "insufficientInformation"],
  properties: {
    answer: { type: "string" },
    citationIds: { type: "array", items: { type: "string" } },
    insufficientInformation: { type: "boolean" },
  },
} as const;

const KNOWLEDGE_LOCALES = new Set(["zh-Hant", "zh-Hans", "en"]);
const KNOWLEDGE_SYSTEM_PROMPT_MAX_CHARS = 8_000;
const KNOWLEDGE_USER_PROMPT_MAX_CHARS = 70_000;

function isPlainText(value: string): boolean {
  return !/<[^>]+>/.test(value) && !/```/.test(value);
}

export function validateKnowledgeLocale(value: unknown): string | null {
  return typeof value === "string" && KNOWLEDGE_LOCALES.has(value)
    ? value
    : null;
}

function validatePromptPair(
  systemPrompt: unknown,
  userPrompt: unknown,
): { systemPrompt: string; userPrompt: string } | null {
  if (typeof systemPrompt !== "string" || typeof userPrompt !== "string") {
    return null;
  }
  const trimmedSystem = systemPrompt.trim();
  const trimmedUser = userPrompt.trim();
  if (
    !trimmedSystem ||
    !trimmedUser ||
    trimmedSystem.length > KNOWLEDGE_SYSTEM_PROMPT_MAX_CHARS ||
    trimmedUser.length > KNOWLEDGE_USER_PROMPT_MAX_CHARS
  ) {
    return null;
  }
  return { systemPrompt: trimmedSystem, userPrompt: trimmedUser };
}

export function validateKnowledgeOrganizeRequest(
  body: Record<string, unknown>,
): CrmAiKnowledgeOrganizeRequest | null {
  if (body.task !== "knowledge_organize") return null;
  if (body.schemaVersion !== KNOWLEDGE_ORGANIZE_PROMPT_VERSION) return null;
  const locale = validateKnowledgeLocale(body.locale);
  const prompts = validatePromptPair(body.systemPrompt, body.userPrompt);
  if (!locale || !prompts) return null;
  return {
    task: "knowledge_organize",
    schemaVersion: KNOWLEDGE_ORGANIZE_PROMPT_VERSION,
    locale,
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt,
  };
}

export function validateKnowledgeQaRequest(
  body: Record<string, unknown>,
): CrmAiKnowledgeQaRequest | null {
  if (body.task !== "knowledge_qa") return null;
  if (body.schemaVersion !== KNOWLEDGE_QA_PROMPT_VERSION) return null;
  const locale = validateKnowledgeLocale(body.locale);
  const prompts = validatePromptPair(body.systemPrompt, body.userPrompt);
  if (!locale || !prompts) return null;
  return {
    task: "knowledge_qa",
    schemaVersion: KNOWLEDGE_QA_PROMPT_VERSION,
    locale,
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt,
  };
}

function validateOrganizeOutput(value: unknown): KnowledgeOrganizeOutput | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const body =
    typeof record.body === "string" ? record.body.trim() : "";
  const summary =
    record.summary === null
      ? null
      : typeof record.summary === "string"
        ? record.summary.trim()
        : null;
  const suggestedCategory =
    record.suggestedCategory === null
      ? null
      : typeof record.suggestedCategory === "string"
        ? record.suggestedCategory.trim()
        : null;
  const warnings = Array.isArray(record.warnings)
    ? record.warnings
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : null;
  if (
    !title ||
    title.length > 200 ||
    !body ||
    body.length > 100_000 ||
    !isPlainText(title) ||
    !isPlainText(body) ||
    (summary !== null && (summary.length > 1_000 || !isPlainText(summary))) ||
    (suggestedCategory !== null &&
      (suggestedCategory.length > 120 || !isPlainText(suggestedCategory))) ||
    !warnings ||
    warnings.length > 20 ||
    warnings.some((warning) => warning.length > 300 || !isPlainText(warning))
  ) {
    return null;
  }
  return {
    title,
    summary,
    body,
    suggestedCategory,
    warnings,
  };
}

function validateQaOutput(value: unknown): KnowledgeQaOutput | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const answer =
    typeof record.answer === "string" ? record.answer.trim() : "";
  const insufficientInformation = record.insufficientInformation === true;
  const citationIds = Array.isArray(record.citationIds)
    ? record.citationIds
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : null;
  if (
    !answer ||
    answer.length > 8_000 ||
    !isPlainText(answer) ||
    !citationIds ||
    citationIds.length > 8 ||
    citationIds.some((id) => id.length > 120 || !isPlainText(id)) ||
    typeof record.insufficientInformation !== "boolean"
  ) {
    return null;
  }
  return {
    answer,
    citationIds,
    insufficientInformation,
  };
}

function buildKnowledgePayload(
  systemPrompt: string,
  userPrompt: string,
  schema: Readonly<Record<string, unknown>>,
  temperature: number,
  maxTokens: number,
): Record<string, unknown> {
  return {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature,
    max_tokens: maxTokens,
    stream: false,
    response_format: {
      type: "json_schema",
      json_schema: schema,
    },
  };
}

function extractStructuredPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const record = raw as Record<string, unknown>;
  if ("response" in record) {
    return record.response;
  }
  return raw;
}

export async function runKnowledgeOrganize(
  env: CrmAiEnv,
  request: CrmAiKnowledgeOrganizeRequest,
  invokeModel: (
    model: string,
    task: "knowledge_organize",
    schemaVersion: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ) => Promise<unknown>,
  parseJsonValue: (value: unknown) => unknown | null,
  timeoutMs: number,
): Promise<AiServiceResult<KnowledgeOrganizeOutput>> {
  const raw = await invokeModel(
    KNOWLEDGE_MODEL,
    "knowledge_organize",
    request.schemaVersion,
    buildKnowledgePayload(
      request.systemPrompt,
      request.userPrompt,
      KNOWLEDGE_ORGANIZATION_JSON_SCHEMA,
      KNOWLEDGE_ORGANIZE_TEMPERATURE,
      KNOWLEDGE_ORGANIZE_MAX_TOKENS,
    ),
    timeoutMs,
  );
  const structured = parseJsonValue(extractStructuredPayload(raw));
  const validated = structured ? validateOrganizeOutput(structured) : null;
  if (!validated) {
    return { ok: false, error: "invalid_output" };
  }
  return { ok: true, data: validated, model: KNOWLEDGE_MODEL };
}

export async function runKnowledgeQa(
  env: CrmAiEnv,
  request: CrmAiKnowledgeQaRequest,
  invokeModel: (
    model: string,
    task: "knowledge_qa",
    schemaVersion: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ) => Promise<unknown>,
  parseJsonValue: (value: unknown) => unknown | null,
  timeoutMs: number,
): Promise<AiServiceResult<KnowledgeQaOutput>> {
  const raw = await invokeModel(
    KNOWLEDGE_MODEL,
    "knowledge_qa",
    request.schemaVersion,
    buildKnowledgePayload(
      request.systemPrompt,
      request.userPrompt,
      KNOWLEDGE_QA_JSON_SCHEMA,
      KNOWLEDGE_QA_TEMPERATURE,
      KNOWLEDGE_QA_MAX_TOKENS,
    ),
    timeoutMs,
  );
  const structured = parseJsonValue(extractStructuredPayload(raw));
  const validated = structured ? validateQaOutput(structured) : null;
  if (!validated) {
    return { ok: false, error: "invalid_output" };
  }
  return { ok: true, data: validated, model: KNOWLEDGE_MODEL };
}

export type KnowledgeRunFailureMapper = (error: unknown) => AiServiceError;
