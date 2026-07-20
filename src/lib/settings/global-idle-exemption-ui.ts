/**
 * Pure helpers for Admin global idle exemption Settings UI.
 * No React — fully unit-testable.
 */

export const GLOBAL_IDLE_EXEMPTION_API_PATH =
  "/api/admin/settings/global-idle-exemption" as const;

export type GlobalIdleExemptionGetResult =
  | { ok: true; enabled: boolean }
  | { ok: false; error: "invalid_response" };

export type GlobalIdleExemptionPatchResult =
  | { ok: true; enabled: boolean; changed?: boolean }
  | { ok: false; error: "invalid_response" | "request_failed" };

export type GlobalIdleExemptionSwitchPlan =
  | { action: "noop" }
  | { action: "enable_immediately"; enabled: true }
  | { action: "open_disable_confirm" };

/**
 * Parse GET /api/admin/settings/global-idle-exemption.
 * Only accepts `{ enabled: boolean }` — never reads epoch fields.
 */
export function parseGlobalIdleExemptionGetResponse(
  data: unknown,
): GlobalIdleExemptionGetResult {
  if (!data || typeof data !== "object") {
    return { ok: false, error: "invalid_response" };
  }
  const record = data as Record<string, unknown>;
  if (typeof record.enabled !== "boolean") {
    return { ok: false, error: "invalid_response" };
  }
  return { ok: true, enabled: record.enabled };
}

/**
 * Build PATCH body. Never includes epoch / reverify fields.
 */
export function buildGlobalIdleExemptionPatchBody(enabled: boolean): {
  enabled: boolean;
} {
  return { enabled };
}

/**
 * Ensure a PATCH payload object has no forbidden epoch keys.
 */
export function patchBodyExposesEpoch(body: Record<string, unknown>): boolean {
  const forbidden = [
    "staffAccessReverifyAfter",
    "staff_access_reverify_after",
    "epoch",
    "timestamp",
  ];
  return forbidden.some((key) => key in body);
}

export function parseGlobalIdleExemptionPatchResponse(
  data: unknown,
  httpOk: boolean,
): GlobalIdleExemptionPatchResult {
  if (!httpOk) {
    return { ok: false, error: "request_failed" };
  }
  if (!data || typeof data !== "object") {
    return { ok: false, error: "invalid_response" };
  }
  const record = data as Record<string, unknown>;
  if (typeof record.enabled !== "boolean") {
    return { ok: false, error: "invalid_response" };
  }
  return {
    ok: true,
    enabled: record.enabled,
    changed: typeof record.changed === "boolean" ? record.changed : undefined,
  };
}

/**
 * Decide what happens when the Admin toggles the switch.
 * true → false requires confirm; false → true saves immediately;
 * same-value is a no-op (no request).
 */
export function planGlobalIdleExemptionSwitchClick(
  currentEnabled: boolean,
  nextEnabled: boolean,
): GlobalIdleExemptionSwitchPlan {
  if (currentEnabled === nextEnabled) {
    return { action: "noop" };
  }
  if (currentEnabled === false && nextEnabled === true) {
    return { action: "enable_immediately", enabled: true };
  }
  return { action: "open_disable_confirm" };
}

export function shouldDisableSwitchControls(input: {
  loading: boolean;
  saving: boolean;
  loadError: boolean;
}): boolean {
  return input.loading || input.saving || input.loadError;
}
