import {
  AI_GATEWAY_ID,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  HEALTH_PROBE_JSON_SCHEMA,
  HEALTH_PROBE_SYSTEM_PROMPT,
  SYNTHETIC_HEALTH_PROBE_USER_PROMPT,
  resolveModelForTask,
  resolveTimeoutMs,
} from "./models";
import { logCrmAiEvent } from "./logging";
import { validateHealthProbeOutput } from "./validate";
import type {
  AiServiceError,
  AiServiceResult,
  CrmAiEnv,
  CrmAiRequest,
  HealthProbeOutput,
  SystemAiTask,
} from "./types";

const MAX_RETRIES = 1;

type GatewayOptions = {
  gateway: {
    id: string;
    collectLog: false;
    metadata: {
      task: SystemAiTask;
      schemaVersion: "10a-v1";
    };
  };
};

function gatewayOptions(task: SystemAiTask): GatewayOptions {
  return {
    gateway: {
      id: AI_GATEWAY_ID,
      collectLog: false,
      metadata: {
        task,
        schemaVersion: "10a-v1",
      },
    },
  };
}

function mapRunFailure(error: unknown): AiServiceError {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "timeout";
  }
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error);
  if (message.includes("rate") || message.includes("429")) {
    return "rate_limited";
  }
  if (
    message.includes("json mode couldn't be met") ||
    message.includes("invalid")
  ) {
    return "invalid_output";
  }
  if (message.includes("unavailable") || message.includes("503")) {
    return "model_unavailable";
  }
  return "internal_error";
}

function extractStructuredPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const record = raw as Record<string, unknown>;
  if ("response" in record) {
    return record.response;
  }
  return raw;
}

function parseJsonValue(value: unknown): unknown | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("```")) {
      const stripped = trimmed
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      try {
        return JSON.parse(stripped) as unknown;
      } catch {
        return null;
      }
    }
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && value !== null) {
    return value;
  }
  return null;
}

async function runWithTimeout<T>(
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function invokeModel(
  env: CrmAiEnv,
  model: string,
  task: SystemAiTask,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  return runWithTimeout(timeoutMs, async (signal) => {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    return env.AI.run(model, payload, gatewayOptions(task));
  });
}

function buildStructuredPayload(): Record<string, unknown> {
  return {
    messages: [
      { role: "system", content: HEALTH_PROBE_SYSTEM_PROMPT },
      { role: "user", content: SYNTHETIC_HEALTH_PROBE_USER_PROMPT },
    ],
    temperature: DEFAULT_TEMPERATURE,
    max_tokens: DEFAULT_MAX_TOKENS,
    stream: false,
    response_format: {
      type: "json_schema",
      json_schema: HEALTH_PROBE_JSON_SCHEMA,
    },
  };
}

async function runStructuredAttempt(
  env: CrmAiEnv,
  model: string,
  task: SystemAiTask,
  timeoutMs: number,
): Promise<AiServiceResult<HealthProbeOutput>> {
  const raw = await invokeModel(
    env,
    model,
    task,
    buildStructuredPayload(),
    timeoutMs,
  );
  const structured = parseJsonValue(extractStructuredPayload(raw));
  if (!structured || !validateHealthProbeOutput(structured)) {
    return { ok: false, error: "invalid_output" };
  }
  return { ok: true, data: structured, model };
}

export async function runHealthProbe(
  env: CrmAiEnv,
  requestedModel?: string,
): Promise<AiServiceResult<HealthProbeOutput>> {
  const task: SystemAiTask = "health_probe";
  const model = resolveModelForTask(task, requestedModel);
  const timeoutMs = resolveTimeoutMs(env.CRM_AI_TIMEOUT_MS);
  const startedAt = Date.now();

  let lastError: AiServiceError = "internal_error";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await runStructuredAttempt(env, model, task, timeoutMs);
      if (!result.ok && result.error === "invalid_output" && attempt < MAX_RETRIES) {
        lastError = result.error;
        continue;
      }
      logCrmAiEvent({
        task,
        model,
        ok: result.ok,
        durationMs: Date.now() - startedAt,
        error: result.ok ? undefined : result.error,
      });
      return result;
    } catch (error) {
      lastError = mapRunFailure(error);
      if (attempt >= MAX_RETRIES) break;
      if (
        lastError !== "invalid_output" &&
        lastError !== "model_unavailable" &&
        lastError !== "timeout"
      ) {
        break;
      }
    }
  }

  logCrmAiEvent({
    task,
    model,
    ok: false,
    durationMs: Date.now() - startedAt,
    error: lastError,
  });
  return { ok: false, error: lastError };
}

export async function runStructuredProbe(
  env: CrmAiEnv,
  requestedModel?: string,
): Promise<AiServiceResult<HealthProbeOutput>> {
  const task: SystemAiTask = "structured_probe";
  const model = resolveModelForTask(task, requestedModel);
  const timeoutMs = resolveTimeoutMs(env.CRM_AI_TIMEOUT_MS);
  const startedAt = Date.now();

  let lastError: AiServiceError = "internal_error";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await runStructuredAttempt(env, model, task, timeoutMs);
      if (!result.ok && result.error === "invalid_output" && attempt < MAX_RETRIES) {
        lastError = result.error;
        continue;
      }
      logCrmAiEvent({
        task,
        model,
        ok: result.ok,
        durationMs: Date.now() - startedAt,
        error: result.ok ? undefined : result.error,
      });
      return result;
    } catch (error) {
      lastError = mapRunFailure(error);
      if (attempt >= MAX_RETRIES) break;
      if (
        lastError !== "invalid_output" &&
        lastError !== "model_unavailable" &&
        lastError !== "timeout"
      ) {
        break;
      }
    }
  }

  logCrmAiEvent({
    task,
    model,
    ok: false,
    durationMs: Date.now() - startedAt,
    error: lastError,
  });
  return { ok: false, error: lastError };
}

export async function handleCrmAiRequest(
  env: CrmAiEnv,
  request: CrmAiRequest,
): Promise<AiServiceResult<HealthProbeOutput>> {
  if (request.task === "health_probe") {
    return runHealthProbe(env, request.model);
  }
  if (request.task === "structured_probe") {
    return runStructuredProbe(env, request.model);
  }
  return { ok: false, error: "internal_error" };
}

export function parseCrmAiRequestBody(body: unknown): CrmAiRequest | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (record.task === "health_probe" || record.task === "structured_probe") {
    const model =
      typeof record.model === "string" && record.model.trim()
        ? record.model.trim()
        : undefined;
    return { task: record.task, model };
  }
  return null;
}
