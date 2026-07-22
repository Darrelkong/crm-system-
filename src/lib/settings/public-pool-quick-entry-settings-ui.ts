/**
 * Pure helpers for Admin Public Pool Quick Entry settings UI.
 * No React — fully unit-testable. Server remains the authority.
 */

import { validateQuickEntryCodeFormat } from "@/lib/public-pool/quick-entry-code";
import { QUICK_ENTRY_ERROR_CODES } from "@/lib/public-pool/quick-entry-constants";
import { formatHongKongDateTime } from "@/lib/timezone";

export const ADMIN_QUICK_ENTRY_API_PATH =
  "/api/admin/public-pool-quick-entry" as const;

export type AdminQuickEntryState = {
  enabled: boolean;
  hasCode: boolean;
  codeUpdatedAt: string | null;
  updatedBy: { userId: string; name: string } | null;
};

export type AdminQuickEntryParseResult =
  | { ok: true; state: AdminQuickEntryState }
  | { ok: false; error: "invalid_response" };

export type AdminQuickEntrySwitchPlan =
  | { action: "noop" }
  | { action: "block_need_code" }
  | { action: "enable_immediately" }
  | { action: "open_disable_confirm" };

export type ClientCodeValidation =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "format"
        | "mismatch"
        | "empty";
    };

const FORBIDDEN_ADMIN_RESPONSE_KEYS = [
  "code",
  "codeHash",
  "code_hash",
  "plaintext",
  "grantVersion",
  "grant_version",
  "sessionId",
  "lockedUntil",
] as const;

const FORBIDDEN_ADMIN_REQUEST_KEYS = [
  "codeHash",
  "grantVersion",
  "sessionId",
  "actorId",
  "submissionDbId",
  "requestHash",
] as const;

export function parseAdminQuickEntryState(
  data: unknown,
): AdminQuickEntryParseResult {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "invalid_response" };
  }
  const record = data as Record<string, unknown>;
  if (typeof record.enabled !== "boolean") {
    return { ok: false, error: "invalid_response" };
  }
  if (typeof record.hasCode !== "boolean") {
    return { ok: false, error: "invalid_response" };
  }
  const codeUpdatedAt =
    record.codeUpdatedAt === null || typeof record.codeUpdatedAt === "string"
      ? record.codeUpdatedAt
      : null;

  let updatedBy: AdminQuickEntryState["updatedBy"] = null;
  if (record.updatedBy != null) {
    if (typeof record.updatedBy !== "object" || Array.isArray(record.updatedBy)) {
      return { ok: false, error: "invalid_response" };
    }
    const by = record.updatedBy as Record<string, unknown>;
    if (typeof by.userId !== "string" || typeof by.name !== "string") {
      return { ok: false, error: "invalid_response" };
    }
    updatedBy = { userId: by.userId, name: by.name };
  }

  return {
    ok: true,
    state: {
      enabled: record.enabled,
      hasCode: record.hasCode,
      codeUpdatedAt,
      updatedBy,
    },
  };
}

export function adminResponseExposesSecrets(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  return FORBIDDEN_ADMIN_RESPONSE_KEYS.some((key) => key in record);
}

export function buildSetCodeBody(
  code: string,
  confirmCode: string,
): { action: "set_code"; code: string; confirmCode: string } {
  return { action: "set_code", code, confirmCode };
}

export function buildSetEnabledBody(enabled: boolean): {
  action: "set_enabled";
  enabled: boolean;
} {
  return { action: "set_enabled", enabled };
}

export function adminRequestBodyHasForbiddenKeys(
  body: Record<string, unknown>,
): boolean {
  return FORBIDDEN_ADMIN_REQUEST_KEYS.some((key) => key in body);
}

export function validateClientQuickEntryCodePair(
  code: string,
  confirmCode: string,
): ClientCodeValidation {
  if (!code || !confirmCode) {
    return { ok: false, reason: "empty" };
  }
  if (code !== confirmCode) {
    return { ok: false, reason: "mismatch" };
  }
  const format = validateQuickEntryCodeFormat(code);
  if (!format.ok) {
    return { ok: false, reason: "format" };
  }
  return { ok: true };
}

export function planAdminQuickEntrySwitchClick(input: {
  currentEnabled: boolean;
  nextEnabled: boolean;
  hasCode: boolean;
}): AdminQuickEntrySwitchPlan {
  if (input.currentEnabled === input.nextEnabled) {
    return { action: "noop" };
  }
  if (input.nextEnabled === true) {
    if (!input.hasCode) {
      return { action: "block_need_code" };
    }
    return { action: "enable_immediately" };
  }
  return { action: "open_disable_confirm" };
}

export function formatQuickEntryCodeUpdatedAt(
  codeUpdatedAt: string | null,
  emptyLabel: string,
): string {
  if (!codeUpdatedAt) return emptyLabel;
  return formatHongKongDateTime(codeUpdatedAt, emptyLabel);
}

export function mapAdminQuickEntryErrorCode(
  errorCode: string | undefined,
):
  | "mismatch"
  | "format"
  | "not_configured"
  | "validation"
  | "generic" {
  switch (errorCode) {
    case QUICK_ENTRY_ERROR_CODES.CODE_CONFIRMATION_MISMATCH:
      return "mismatch";
    case QUICK_ENTRY_ERROR_CODES.CODE_INVALID_FORMAT:
      return "format";
    case QUICK_ENTRY_ERROR_CODES.CODE_NOT_CONFIGURED:
      return "not_configured";
    case QUICK_ENTRY_ERROR_CODES.VALIDATION_ERROR:
      return "validation";
    default:
      return "generic";
  }
}

export function parseAdminErrorCode(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  return typeof record.errorCode === "string" ? record.errorCode : undefined;
}

export function shouldDisableAdminQuickEntryControls(input: {
  loading: boolean;
  saving: boolean;
  loadError: boolean;
}): boolean {
  return input.loading || input.saving || input.loadError;
}
