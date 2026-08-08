export type SystemAiTask = "health_probe" | "structured_probe";

export type AiServiceError =
  | "timeout"
  | "invalid_output"
  | "model_unavailable"
  | "rate_limited"
  | "internal_error";

export type AiServiceResult<T> =
  | { ok: true; data: T; model: string }
  | { ok: false; error: AiServiceError };

export type HealthProbeOutput = {
  status: "ok";
  summary: string;
};

export type CrmAiRequest = {
  task: SystemAiTask;
  model?: string;
};

export type CrmAiEnv = {
  AI: Ai;
  CRM_AI_TIMEOUT_MS?: string;
};
