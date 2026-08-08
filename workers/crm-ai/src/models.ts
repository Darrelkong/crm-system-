/** Cloudflare Workers AI model identifiers for Phase 10A benchmark. */
export const MODEL_QWEN = "@cf/qwen/qwen3-30b-a3b-fp8";
export const MODEL_LLAMA = "@cf/meta/llama-3.1-8b-instruct-fast";

export const AI_GATEWAY_ID = "default";

export const DEFAULT_TIMEOUT_MS = 18_000;
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
