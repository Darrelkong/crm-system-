/** Cloudflare Workers AI model identifiers for Phase 10A benchmark. */
export const MODEL_QWEN = "@cf/qwen/qwen3-30b-a3b-fp8";
export const MODEL_LLAMA = "@cf/meta/llama-3.1-8b-instruct-fast";
export const MODEL_VISION_LLAMA =
  "@cf/meta/llama-3.2-11b-vision-instruct";
export const MODEL_VISION_GEMMA =
  "@cf/google/gemma-4-26b-a4b-it";

export const AI_GATEWAY_ID = "default";

export const DEFAULT_TIMEOUT_MS = 18_000;
export const ADMIN_BRIEF_TOTAL_DEADLINE_MS = 20_000;
export const DEFAULT_TEMPERATURE = 0.2;
export const DEFAULT_MAX_TOKENS = 512;
export const MAX_SUMMARY_LENGTH = 600;

/** Selected after remote benchmark — Qwen 3/3 structured JSON + stronger Chinese. */
export const DEFAULT_GENERAL_MODEL = MODEL_QWEN;
export const DEFAULT_STRUCTURED_MODEL = MODEL_QWEN;

export const SYNTHETIC_HEALTH_PROBE_USER_PROMPT =
  "请用简体中文总结：今日新增客户 3，今日有效跟进 8，7天内风险客户 2";

export const HEALTH_PROBE_SYSTEM_PROMPT =
  "你是 CRM 运营助手。根据用户提供的数据摘要，用简体中文输出 JSON，字段 status 固定为 ok，summary 为简短管理摘要。";

export const HEALTH_PROBE_JSON_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["ok"] },
    summary: { type: "string", maxLength: MAX_SUMMARY_LENGTH },
  },
  required: ["status", "summary"],
} as const;

export const BENCHMARK_MODELS = [MODEL_QWEN, MODEL_LLAMA] as const;

export const ADMIN_MANAGEMENT_BRIEF_MODEL = MODEL_QWEN;
export const ADMIN_MANAGEMENT_BRIEF_MAX_RETRIES = 1;

export const STAFF_TODAY_ACTIONS_MODEL = MODEL_QWEN;
export const STAFF_TODAY_ACTIONS_MAX_RETRIES = 1;
export const STAFF_TODAY_ACTIONS_TOTAL_DEADLINE_MS = 20_000;

export const KNOWLEDGE_ORGANIZE_PROMPT_VERSION = "knowledge-organize-v1";
export const KNOWLEDGE_QA_PROMPT_VERSION = "knowledge-qa-v1";
export const KNOWLEDGE_COMPARE_PROMPT_VERSION = "knowledge-compare-v1";
export const KNOWLEDGE_MODEL = MODEL_QWEN;
export const KNOWLEDGE_ORGANIZE_TEMPERATURE = 0.2;
export const KNOWLEDGE_QA_TEMPERATURE = 0.2;
export const KNOWLEDGE_COMPARE_TEMPERATURE = 0.2;
export const KNOWLEDGE_ORGANIZE_MAX_TOKENS = 4096;
export const KNOWLEDGE_QA_MAX_TOKENS = 2048;
export const KNOWLEDGE_COMPARE_MAX_TOKENS = 3072;
export const KNOWLEDGE_MAX_RETRIES = 1;
export const KNOWLEDGE_TOTAL_DEADLINE_MS = 20_000;

export const KNOWLEDGE_VISION_EXTRACT_PROMPT_VERSION =
  "knowledge-vision-extract-v1";
/** Selected after P2C-B1.2 OCR benchmark — Gemma 4 plain transcription. */
export const KNOWLEDGE_VISION_MODEL = MODEL_VISION_GEMMA;
export const KNOWLEDGE_VISION_EXTRACT_TEMPERATURE = 0.1;
export const KNOWLEDGE_VISION_EXTRACT_MAX_TOKENS = 4096;
export const KNOWLEDGE_VISION_MAX_RETRIES = 1;
export const KNOWLEDGE_VISION_TOTAL_DEADLINE_MS = 60_000;
/** Base64 payload cap (~10 MiB raw image upper bound). */
export const KNOWLEDGE_VISION_IMAGE_MAX_BASE64_CHARS = 14_000_000;

export function resolveTimeoutMs(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  const rounded = Math.round(parsed);
  // Tests may set a short deadline via CRM_AI_TIMEOUT_MS (e.g. 50ms).
  if (process.env.NODE_ENV === "test" && rounded >= 50) {
    return rounded;
  }
  return Math.min(20_000, Math.max(15_000, rounded));
}

export function resolveAdminBriefDeadlineMs(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return ADMIN_BRIEF_TOTAL_DEADLINE_MS;
  const rounded = Math.round(parsed);
  if (process.env.NODE_ENV === "test" && rounded >= 50) {
    return rounded;
  }
  return Math.min(20_000, Math.max(15_000, rounded));
}

export function resolveStaffActionsDeadlineMs(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return STAFF_TODAY_ACTIONS_TOTAL_DEADLINE_MS;
  const rounded = Math.round(parsed);
  if (process.env.NODE_ENV === "test" && rounded >= 50) {
    return rounded;
  }
  return Math.min(20_000, Math.max(15_000, rounded));
}

export function resolveKnowledgeDeadlineMs(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return KNOWLEDGE_TOTAL_DEADLINE_MS;
  const rounded = Math.round(parsed);
  if (process.env.NODE_ENV === "test" && rounded >= 50) {
    return rounded;
  }
  return Math.min(20_000, Math.max(15_000, rounded));
}

export function resolveKnowledgeVisionDeadlineMs(
  raw: string | undefined,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return KNOWLEDGE_VISION_TOTAL_DEADLINE_MS;
  const rounded = Math.round(parsed);
  if (process.env.NODE_ENV === "test" && rounded >= 50) {
    return rounded;
  }
  return Math.min(60_000, Math.max(15_000, rounded));
}

export function resolveModelForTask(
  task: "health_probe" | "structured_probe",
  requested?: string,
): string {
  if (requested === MODEL_QWEN || requested === MODEL_LLAMA) {
    return requested;
  }
  return task === "structured_probe"
    ? DEFAULT_STRUCTURED_MODEL
    : DEFAULT_GENERAL_MODEL;
}
