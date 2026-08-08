import {
  AI_GATEWAY_ID,
  ADMIN_MANAGEMENT_BRIEF_MAX_RETRIES,
  ADMIN_MANAGEMENT_BRIEF_MODEL,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  HEALTH_PROBE_JSON_SCHEMA,
  HEALTH_PROBE_SYSTEM_PROMPT,
  SYNTHETIC_HEALTH_PROBE_USER_PROMPT,
  resolveAdminBriefDeadlineMs,
  resolveModelForTask,
  resolveStaffActionsDeadlineMs,
  resolveTimeoutMs,
  STAFF_TODAY_ACTIONS_MAX_RETRIES,
  STAFF_TODAY_ACTIONS_MODEL,
} from "./models";
import {
  ADMIN_BRIEF_JSON_SCHEMA,
  ADMIN_BRIEF_MAX_TOKENS,
  ADMIN_BRIEF_TEMPERATURE,
  ADMIN_MANAGEMENT_BRIEF_PROMPT_VERSION,
  buildAdminBriefSystemPrompt,
  buildAdminBriefUserPrompt,
} from "./admin-brief";
import {
  STAFF_TODAY_ACTIONS_JSON_SCHEMA,
  STAFF_TODAY_ACTIONS_PROMPT_VERSION,
  STAFF_ACTIONS_MAX_TOKENS,
  STAFF_ACTIONS_TEMPERATURE,
  buildStaffActionsSystemPrompt,
  buildStaffActionsUserPrompt,
} from "./staff-actions";
import { logCrmAiEvent } from "./logging";
import { validateHealthProbeOutput } from "./validate";
import {
  validateAdminBriefContext,
  validateAdminBriefLocale,
  type ValidatedAdminContext,
} from "./validate-admin-context";
import { validateAdminBriefOutput } from "./validate-admin-output";
import {
  validateStaffActionsContext,
  validateStaffActionsLocale,
  type ValidatedStaffContext,
} from "./validate-staff-context";
import { validateStaffActionsOutput } from "./validate-staff-output";
import type {
  AdminBriefOutput,
  AiServiceError,
  AiServiceResult,
  CrmAiAdminBriefRequest,
  CrmAiEnv,
  CrmAiHandleResult,
  CrmAiRequest,
  CrmAiStaffActionsRequest,
  HealthProbeOutput,
  StaffTodayActionsOutput,
  SystemAiTask,
} from "./types";

const MAX_RETRIES = 1;

/** Returned when the caller response deadline is reached (not GPU cancellation). */
export class ResponseDeadlineError extends Error {
  constructor() {
    super("response_deadline");
    this.name = "ResponseDeadlineError";
  }
}

type GatewayOptions = {
  gateway: {
    id: string;
    collectLog: false;
    metadata: {
      task: SystemAiTask;
      schemaVersion: string;
    };
  };
};

function gatewayOptions(
  task: SystemAiTask,
  schemaVersion: string,
): GatewayOptions {
  return {
    gateway: {
      id: AI_GATEWAY_ID,
      collectLog: false,
      metadata: {
        task,
        schemaVersion,
      },
    },
  };
}

function mapRunFailure(error: unknown): AiServiceError {
  if (error instanceof ResponseDeadlineError) {
    return "timeout";
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return "timeout";
  }

  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "number"
      ? (error as { code: number }).code
      : undefined;
  if (code === 3007 || code === 3008) {
    return "timeout";
  }

  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (
    message.includes("408") ||
    message.includes("timeout") ||
    message.includes("aborted") ||
    message.includes("3007") ||
    message.includes("3008")
  ) {
    return "timeout";
  }
  if (message.includes("rate") || message.includes("429")) {
    return "rate_limited";
  }
  if (
    message.includes("json mode couldn't be met") ||
    (message.includes("invalid") && !message.includes("invalid_output"))
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

/**
 * Application response deadline via Promise.race.
 * Workers AI binding does not expose caller AbortSignal cancellation;
 * inference may continue after we return timeout to the caller.
 */
export async function runWithResponseDeadline<T>(
  timeoutMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const deadlinePromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new ResponseDeadlineError()), timeoutMs);
  });

  const taskPromise = operation();

  try {
    return await Promise.race([taskPromise, deadlinePromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    // Late-settling provider work must not surface as unhandled rejection.
    void taskPromise.catch(() => {});
  }
}

async function invokeModel(
  env: CrmAiEnv,
  model: string,
  task: SystemAiTask,
  schemaVersion: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  return runWithResponseDeadline(timeoutMs, () =>
    env.AI.run(model, payload, gatewayOptions(task, schemaVersion)),
  );
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
    "10a-v1",
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

function buildAdminBriefPayload(
  locale: string,
  context: ValidatedAdminContext,
): Record<string, unknown> {
  const contextJson = JSON.stringify(context, null, 2);
  return {
    messages: [
      { role: "system", content: buildAdminBriefSystemPrompt(locale) },
      { role: "user", content: buildAdminBriefUserPrompt(contextJson) },
    ],
    temperature: ADMIN_BRIEF_TEMPERATURE,
    max_tokens: ADMIN_BRIEF_MAX_TOKENS,
    stream: false,
    response_format: {
      type: "json_schema",
      json_schema: ADMIN_BRIEF_JSON_SCHEMA,
    },
  };
}

async function runAdminBriefAttempt(
  env: CrmAiEnv,
  request: CrmAiAdminBriefRequest,
  timeoutMs: number,
): Promise<AiServiceResult<AdminBriefOutput>> {
  const validatedContext = validateAdminBriefContext(request.context);
  if (!validatedContext) {
    return { ok: false, error: "invalid_output" };
  }

  const raw = await invokeModel(
    env,
    ADMIN_MANAGEMENT_BRIEF_MODEL,
    "admin_management_brief",
    request.schemaVersion,
    buildAdminBriefPayload(request.locale, validatedContext),
    timeoutMs,
  );
  const structured = parseJsonValue(extractStructuredPayload(raw));
  if (!structured || !validateAdminBriefOutput(structured)) {
    return { ok: false, error: "invalid_output" };
  }
  return {
    ok: true,
    data: structured,
    model: ADMIN_MANAGEMENT_BRIEF_MODEL,
  };
}

export async function runAdminManagementBrief(
  env: CrmAiEnv,
  request: CrmAiAdminBriefRequest,
): Promise<AiServiceResult<AdminBriefOutput>> {
  const task: SystemAiTask = "admin_management_brief";
  const totalDeadlineMs = resolveAdminBriefDeadlineMs(env.CRM_AI_TIMEOUT_MS);
  const startedAt = Date.now();

  let lastError: AiServiceError = "internal_error";

  for (let attempt = 0; attempt <= ADMIN_MANAGEMENT_BRIEF_MAX_RETRIES; attempt++) {
    const elapsed = Date.now() - startedAt;
    const remainingMs = totalDeadlineMs - elapsed;
    if (remainingMs <= 100) {
      lastError = "timeout";
      break;
    }

    try {
      const result = await runAdminBriefAttempt(env, request, remainingMs);
      if (
        !result.ok &&
        result.error === "invalid_output" &&
        attempt < ADMIN_MANAGEMENT_BRIEF_MAX_RETRIES
      ) {
        lastError = result.error;
        continue;
      }
      if (!result.ok && result.error === "model_unavailable" && attempt < ADMIN_MANAGEMENT_BRIEF_MAX_RETRIES) {
        lastError = result.error;
        continue;
      }
      if (!result.ok && result.error === "timeout") {
        lastError = result.error;
        break;
      }

      logCrmAiEvent({
        task,
        model: ADMIN_MANAGEMENT_BRIEF_MODEL,
        ok: result.ok,
        durationMs: Date.now() - startedAt,
        error: result.ok ? undefined : result.error,
      });
      return result;
    } catch (error) {
      lastError = mapRunFailure(error);
      if (lastError === "timeout") {
        break;
      }
      if (
        attempt >= ADMIN_MANAGEMENT_BRIEF_MAX_RETRIES ||
        (lastError !== "invalid_output" && lastError !== "model_unavailable")
      ) {
        break;
      }
    }
  }

  logCrmAiEvent({
    task,
    model: ADMIN_MANAGEMENT_BRIEF_MODEL,
    ok: false,
    durationMs: Date.now() - startedAt,
    error: lastError,
  });
  return { ok: false, error: lastError };
}

function buildStaffActionsPayload(
  locale: string,
  context: ValidatedStaffContext,
): Record<string, unknown> {
  const { allowedCustomerRefs: _allowed, ...providerContext } = context;
  const contextJson = JSON.stringify(providerContext, null, 2);
  return {
    messages: [
      { role: "system", content: buildStaffActionsSystemPrompt(locale) },
      { role: "user", content: buildStaffActionsUserPrompt(contextJson) },
    ],
    temperature: STAFF_ACTIONS_TEMPERATURE,
    max_tokens: STAFF_ACTIONS_MAX_TOKENS,
    stream: false,
    response_format: {
      type: "json_schema",
      json_schema: STAFF_TODAY_ACTIONS_JSON_SCHEMA,
    },
  };
}

async function runStaffActionsAttempt(
  env: CrmAiEnv,
  request: CrmAiStaffActionsRequest,
  timeoutMs: number,
): Promise<AiServiceResult<StaffTodayActionsOutput>> {
  const validatedContext = validateStaffActionsContext(request.context);
  if (!validatedContext) {
    return { ok: false, error: "invalid_output" };
  }

  const raw = await invokeModel(
    env,
    STAFF_TODAY_ACTIONS_MODEL,
    "staff_today_actions",
    request.schemaVersion,
    buildStaffActionsPayload(request.locale, validatedContext),
    timeoutMs,
  );
  const structured = parseJsonValue(extractStructuredPayload(raw));
  if (
    !structured ||
    !validateStaffActionsOutput(structured, validatedContext.allowedCustomerRefs)
  ) {
    return { ok: false, error: "invalid_output" };
  }
  return {
    ok: true,
    data: structured,
    model: STAFF_TODAY_ACTIONS_MODEL,
  };
}

export async function runStaffTodayActions(
  env: CrmAiEnv,
  request: CrmAiStaffActionsRequest,
): Promise<AiServiceResult<StaffTodayActionsOutput>> {
  const task: SystemAiTask = "staff_today_actions";
  const totalDeadlineMs = resolveStaffActionsDeadlineMs(env.CRM_AI_TIMEOUT_MS);
  const startedAt = Date.now();

  let lastError: AiServiceError = "internal_error";

  for (let attempt = 0; attempt <= STAFF_TODAY_ACTIONS_MAX_RETRIES; attempt++) {
    const elapsed = Date.now() - startedAt;
    const remainingMs = totalDeadlineMs - elapsed;
    if (remainingMs <= 100) {
      lastError = "timeout";
      break;
    }

    try {
      const result = await runStaffActionsAttempt(env, request, remainingMs);
      if (
        !result.ok &&
        result.error === "invalid_output" &&
        attempt < STAFF_TODAY_ACTIONS_MAX_RETRIES
      ) {
        lastError = result.error;
        continue;
      }
      if (
        !result.ok &&
        result.error === "model_unavailable" &&
        attempt < STAFF_TODAY_ACTIONS_MAX_RETRIES
      ) {
        lastError = result.error;
        continue;
      }
      if (!result.ok && result.error === "timeout") {
        lastError = result.error;
        break;
      }

      logCrmAiEvent({
        task,
        model: STAFF_TODAY_ACTIONS_MODEL,
        ok: result.ok,
        durationMs: Date.now() - startedAt,
        error: result.ok ? undefined : result.error,
      });
      return result;
    } catch (error) {
      lastError = mapRunFailure(error);
      if (lastError === "timeout") {
        break;
      }
      if (
        attempt >= STAFF_TODAY_ACTIONS_MAX_RETRIES ||
        (lastError !== "invalid_output" && lastError !== "model_unavailable")
      ) {
        break;
      }
    }
  }

  logCrmAiEvent({
    task,
    model: STAFF_TODAY_ACTIONS_MODEL,
    ok: false,
    durationMs: Date.now() - startedAt,
    error: lastError,
  });
  return { ok: false, error: lastError };
}

export async function handleCrmAiRequest(
  env: CrmAiEnv,
  request: CrmAiRequest,
): Promise<CrmAiHandleResult> {
  if (request.task === "health_probe") {
    return runHealthProbe(env, request.model);
  }
  if (request.task === "structured_probe") {
    return runStructuredProbe(env, request.model);
  }
  if (request.task === "admin_management_brief") {
    return runAdminManagementBrief(env, request);
  }
  if (request.task === "staff_today_actions") {
    return runStaffTodayActions(env, request);
  }
  return { ok: false, error: "internal_error" };
}

export function parseCrmAiRequestBody(body: unknown): CrmAiRequest | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;

  if (record.task === "admin_management_brief") {
    if (record.schemaVersion !== ADMIN_MANAGEMENT_BRIEF_PROMPT_VERSION) {
      return null;
    }
    const locale = validateAdminBriefLocale(record.locale);
    const context = validateAdminBriefContext(record.context);
    if (!locale || !context) {
      return null;
    }
    return {
      task: "admin_management_brief",
      schemaVersion: ADMIN_MANAGEMENT_BRIEF_PROMPT_VERSION,
      locale,
      context,
    };
  }

  if (record.task === "staff_today_actions") {
    if (record.schemaVersion !== STAFF_TODAY_ACTIONS_PROMPT_VERSION) {
      return null;
    }
    const locale = validateStaffActionsLocale(record.locale);
    const context = validateStaffActionsContext(record.context);
    if (!locale || !context) {
      return null;
    }
    const { allowedCustomerRefs: _allowed, ...safeContext } = context;
    return {
      task: "staff_today_actions",
      schemaVersion: STAFF_TODAY_ACTIONS_PROMPT_VERSION,
      locale,
      context: safeContext,
    };
  }

  if (record.task === "health_probe" || record.task === "structured_probe") {
    const model =
      typeof record.model === "string" && record.model.trim()
        ? record.model.trim()
        : undefined;
    return { task: record.task, model };
  }
  return null;
}
