import {
  KNOWLEDGE_MODEL,
  KNOWLEDGE_COMPARE_MAX_TOKENS,
  KNOWLEDGE_COMPARE_PROMPT_VERSION,
  KNOWLEDGE_COMPARE_TEMPERATURE,
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
  CrmAiKnowledgeCompareRequest,
  CrmAiKnowledgeOrganizeRequest,
  CrmAiKnowledgeQaRequest,
  CrmAiEnv,
  KnowledgeCompareOutput,
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

export const KNOWLEDGE_COMPARE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "relationship",
    "matchedCandidateKey",
    "matchConfidence",
    "newFacts",
    "changedFacts",
    "conflicts",
    "uncertainties",
    "suggestedUpdates",
  ],
  properties: {
    relationship: {
      type: "string",
      enum: ["update_existing", "new_article", "ambiguous"],
    },
    matchedCandidateKey: {
      type: ["string", "null"],
      enum: ["C1", "C2", "C3", null],
    },
    matchConfidence: { type: "number" },
    newFacts: { type: "array", items: { type: "object" } },
    changedFacts: { type: "array", items: { type: "object" } },
    conflicts: { type: "array", items: { type: "object" } },
    uncertainties: { type: "array", items: { type: "object" } },
    suggestedUpdates: { type: "array", items: { type: "object" } },
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

export function validateKnowledgeCompareRequest(
  body: Record<string, unknown>,
): CrmAiKnowledgeCompareRequest | null {
  if (body.task !== "knowledge_compare") return null;
  if (body.schemaVersion !== KNOWLEDGE_COMPARE_PROMPT_VERSION) return null;
  const locale = validateKnowledgeLocale(body.locale);
  const prompts = validatePromptPair(body.systemPrompt, body.userPrompt);
  if (!locale || !prompts) return null;
  return {
    task: "knowledge_compare",
    schemaVersion: KNOWLEDGE_COMPARE_PROMPT_VERSION,
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

function validateDiffItem(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const topic = typeof record.topic === "string" ? record.topic.trim() : "";
  const explanation =
    typeof record.explanation === "string" ? record.explanation.trim() : "";
  const confidence = record.confidence;
  const existingValue =
    record.existingValue === null
      ? null
      : typeof record.existingValue === "string"
        ? record.existingValue.trim()
        : null;
  const incomingValue =
    record.incomingValue === null
      ? null
      : typeof record.incomingValue === "string"
        ? record.incomingValue.trim()
        : null;
  const sourceExcerpt =
    record.sourceExcerpt === null
      ? null
      : typeof record.sourceExcerpt === "string"
        ? record.sourceExcerpt.trim()
        : null;
  const existingExcerpt =
    record.existingExcerpt === null
      ? null
      : typeof record.existingExcerpt === "string"
        ? record.existingExcerpt.trim()
        : null;
  return (
    !!id &&
    id.length <= 40 &&
    isPlainText(id) &&
    !!topic &&
    topic.length <= 160 &&
    isPlainText(topic) &&
    !!explanation &&
    explanation.length <= 600 &&
    isPlainText(explanation) &&
    typeof confidence === "number" &&
    confidence >= 0 &&
    confidence <= 1 &&
    (existingValue === null ||
      (existingValue.length <= 1_000 && isPlainText(existingValue))) &&
    (incomingValue === null ||
      (incomingValue.length <= 1_000 && isPlainText(incomingValue))) &&
    (sourceExcerpt === null ||
      (sourceExcerpt.length <= 500 && isPlainText(sourceExcerpt))) &&
    (existingExcerpt === null ||
      (existingExcerpt.length <= 500 && isPlainText(existingExcerpt)))
  );
}

function validateSuggestedUpdate(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const topic = typeof record.topic === "string" ? record.topic.trim() : "";
  const suggestion =
    typeof record.suggestion === "string" ? record.suggestion.trim() : "";
  const rationale =
    typeof record.rationale === "string" ? record.rationale.trim() : "";
  const confidence = record.confidence;
  return (
    !!topic &&
    topic.length <= 160 &&
    isPlainText(topic) &&
    !!suggestion &&
    suggestion.length <= 600 &&
    isPlainText(suggestion) &&
    !!rationale &&
    rationale.length <= 600 &&
    isPlainText(rationale) &&
    typeof confidence === "number" &&
    confidence >= 0 &&
    confidence <= 1
  );
}

function validateCompareOutput(value: unknown): KnowledgeCompareOutput | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const relationship = record.relationship;
  const matchedCandidateKey =
    record.matchedCandidateKey === null
      ? null
      : typeof record.matchedCandidateKey === "string"
        ? record.matchedCandidateKey.trim()
        : null;
  const matchConfidence = record.matchConfidence;
  const newFacts = Array.isArray(record.newFacts) ? record.newFacts : null;
  const changedFacts = Array.isArray(record.changedFacts)
    ? record.changedFacts
    : null;
  const conflicts = Array.isArray(record.conflicts) ? record.conflicts : null;
  const uncertainties = Array.isArray(record.uncertainties)
    ? record.uncertainties
    : null;
  const suggestedUpdates = Array.isArray(record.suggestedUpdates)
    ? record.suggestedUpdates
    : null;
  if (
    relationship !== "update_existing" &&
    relationship !== "new_article" &&
    relationship !== "ambiguous"
  ) {
    return null;
  }
  if (
    matchedCandidateKey !== null &&
    matchedCandidateKey !== "C1" &&
    matchedCandidateKey !== "C2" &&
    matchedCandidateKey !== "C3"
  ) {
    return null;
  }
  if (
    typeof matchConfidence !== "number" ||
    matchConfidence < 0 ||
    matchConfidence > 1 ||
    !newFacts ||
    newFacts.length > 20 ||
    !changedFacts ||
    changedFacts.length > 20 ||
    !conflicts ||
    conflicts.length > 20 ||
    !uncertainties ||
    uncertainties.length > 20 ||
    !suggestedUpdates ||
    suggestedUpdates.length > 20 ||
    newFacts.some((item) => !validateDiffItem(item)) ||
    changedFacts.some((item) => !validateDiffItem(item)) ||
    conflicts.some((item) => !validateDiffItem(item)) ||
    uncertainties.some((item) => !validateDiffItem(item)) ||
    suggestedUpdates.some((item) => !validateSuggestedUpdate(item)) ||
    (relationship === "update_existing" && matchedCandidateKey === null)
  ) {
    return null;
  }
  return {
    relationship,
    matchedCandidateKey,
    matchConfidence,
    newFacts: newFacts as KnowledgeCompareOutput["newFacts"],
    changedFacts: changedFacts as KnowledgeCompareOutput["changedFacts"],
    conflicts: conflicts as KnowledgeCompareOutput["conflicts"],
    uncertainties: uncertainties as KnowledgeCompareOutput["uncertainties"],
    suggestedUpdates:
      suggestedUpdates as KnowledgeCompareOutput["suggestedUpdates"],
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

export async function runKnowledgeCompare(
  env: CrmAiEnv,
  request: CrmAiKnowledgeCompareRequest,
  invokeModel: (
    model: string,
    task: "knowledge_compare",
    schemaVersion: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ) => Promise<unknown>,
  parseJsonValue: (value: unknown) => unknown | null,
  timeoutMs: number,
): Promise<AiServiceResult<KnowledgeCompareOutput>> {
  const raw = await invokeModel(
    KNOWLEDGE_MODEL,
    "knowledge_compare",
    request.schemaVersion,
    buildKnowledgePayload(
      request.systemPrompt,
      request.userPrompt,
      KNOWLEDGE_COMPARE_JSON_SCHEMA,
      KNOWLEDGE_COMPARE_TEMPERATURE,
      KNOWLEDGE_COMPARE_MAX_TOKENS,
    ),
    timeoutMs,
  );
  const structured = parseJsonValue(extractStructuredPayload(raw));
  const validated = structured ? validateCompareOutput(structured) : null;
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
