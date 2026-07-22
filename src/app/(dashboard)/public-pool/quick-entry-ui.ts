/**
 * Pure helpers for Public Pool Quick Entry staff UI.
 * No React — fully unit-testable. Server remains the authority.
 */

import {
  QUICK_ENTRY_FIXED_PHONE_COUNTRY_CODE,
  isValidQuickEntryCnPhone,
} from "@/lib/public-pool/quick-entry-customer-validation";
import { QUICK_ENTRY_BATCH_MAX_ROWS } from "@/lib/public-pool/quick-entry-submission-constants";

export const QUICK_ENTRY_STATUS_API_PATH =
  "/api/public-pool/quick-entry/status" as const;
export const QUICK_ENTRY_VERIFY_API_PATH =
  "/api/public-pool/quick-entry/verify" as const;
export const QUICK_ENTRY_CUSTOMERS_API_PATH =
  "/api/public-pool/quick-entry/customers" as const;

export const QUICK_ENTRY_UI_MAX_ROWS = QUICK_ENTRY_BATCH_MAX_ROWS;

export type QuickEntryStatus = {
  enabled: boolean;
  hasCode: boolean;
  grantActive: boolean;
  grantExpiresAt: string | null;
  locked: boolean;
  lockedUntil: string | null;
  retryAfterSeconds: number | null;
};

export type QuickEntryFormRow = {
  clientRowId: string;
  customerName: string;
  phone: string;
  phoneCountryCode: string;
  wechatId: string;
  requestedProjectName: string;
  initialFollowUpNote: string;
  supplementalNote: string;
};

export type QuickEntryRowResultView =
  | {
      clientRowId: string;
      status: "created";
      customerId: string;
      customerCode: string;
      customerName: string;
    }
  | {
      clientRowId: string;
      status: "duplicate";
      errorCode: string;
      duplicateField: "phone" | "wechatId";
    }
  | {
      clientRowId: string;
      status: "invalid";
      errorCode: string;
    }
  | {
      clientRowId: string;
      status: "failed";
      errorCode: string;
    };

export type QuickEntryBatchSummary = {
  total: number;
  created: number;
  duplicates: number;
  invalid: number;
  failed: number;
};

export type QuickEntryBatchSuccessView = {
  ok: true;
  submissionId: string;
  replayed: boolean;
  summary: QuickEntryBatchSummary;
  results: QuickEntryRowResultView[];
};

export type QuickEntryBatchFailureView = {
  ok: false;
  errorCode: string;
  message: string;
  retryAfterSeconds?: number;
};

export type QuickEntryClientRowError =
  | "name_required"
  | "project_required"
  | "contact_required"
  | "phone_invalid";

export type QuickEntryClientValidation =
  | { ok: true }
  | {
      ok: false;
      formError?: "empty" | "too_many" | "duplicate_ids";
      rowErrors: Record<string, QuickEntryClientRowError>;
    };

const FORBIDDEN_BODY_KEYS = [
  "submissionDbId",
  "submission_db_id",
  "internalSubmissionId",
  "requestHash",
  "expectedProcessingStartedAt",
  "actor",
  "actorId",
  "userId",
  "ownerId",
  "owner",
  "source",
  "status",
  "salesStage",
  "createdBy",
  "updatedBy",
  "poolEnteredAt",
  "customerCode",
  "sessionId",
  "grantVersion",
  "code",
  "passcode",
  "lease",
  "leaseToken",
] as const;

const FORBIDDEN_ROW_KEYS = FORBIDDEN_BODY_KEYS;

const ALLOWED_ROW_KEYS = new Set([
  "clientRowId",
  "customerName",
  "phone",
  "phoneCountryCode",
  "wechatId",
  "requestedProjectName",
  "initialFollowUpNote",
  "supplementalNote",
]);

export function createQuickEntryClientRowId(
  randomUuid: () => string = () => crypto.randomUUID(),
): string {
  return randomUuid();
}

export function createQuickEntrySubmissionId(
  randomUuid: () => string = () => crypto.randomUUID(),
): string {
  return randomUuid();
}

export function createEmptyQuickEntryRow(
  randomUuid: () => string = () => crypto.randomUUID(),
): QuickEntryFormRow {
  return {
    clientRowId: createQuickEntryClientRowId(randomUuid),
    customerName: "",
    phone: "",
    phoneCountryCode: QUICK_ENTRY_FIXED_PHONE_COUNTRY_CODE,
    wechatId: "",
    requestedProjectName: "",
    initialFollowUpNote: "",
    supplementalNote: "",
  };
}

export function createNewQuickEntryBatch(
  randomUuid: () => string = () => crypto.randomUUID(),
): { submissionId: string; rows: QuickEntryFormRow[] } {
  return {
    submissionId: createQuickEntrySubmissionId(randomUuid),
    rows: [createEmptyQuickEntryRow(randomUuid)],
  };
}

export function canAddQuickEntryRow(rowCount: number): boolean {
  return rowCount < QUICK_ENTRY_UI_MAX_ROWS;
}

export function canRemoveQuickEntryRow(rowCount: number): boolean {
  return rowCount > 1;
}

export function clearQuickEntryRow(
  row: QuickEntryFormRow,
): QuickEntryFormRow {
  return {
    ...row,
    customerName: "",
    phone: "",
    phoneCountryCode: QUICK_ENTRY_FIXED_PHONE_COUNTRY_CODE,
    wechatId: "",
    requestedProjectName: "",
    initialFollowUpNote: "",
    supplementalNote: "",
  };
}

export function parseQuickEntryStatus(
  data: unknown,
): { ok: true; status: QuickEntryStatus } | { ok: false } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false };
  }
  const r = data as Record<string, unknown>;
  if (
    typeof r.enabled !== "boolean" ||
    typeof r.hasCode !== "boolean" ||
    typeof r.grantActive !== "boolean" ||
    typeof r.locked !== "boolean"
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    status: {
      enabled: r.enabled,
      hasCode: r.hasCode,
      grantActive: r.grantActive,
      grantExpiresAt:
        r.grantExpiresAt === null || typeof r.grantExpiresAt === "string"
          ? r.grantExpiresAt
          : null,
      locked: r.locked,
      lockedUntil:
        r.lockedUntil === null || typeof r.lockedUntil === "string"
          ? r.lockedUntil
          : null,
      retryAfterSeconds:
        r.retryAfterSeconds === null || typeof r.retryAfterSeconds === "number"
          ? r.retryAfterSeconds
          : null,
    },
  };
}

export function buildVerifyCodeBody(code: string): { code: string } {
  return { code };
}

export function verifyBodyHasForbiddenKeys(
  body: Record<string, unknown>,
): boolean {
  return Object.keys(body).some(
    (key) => key !== "code" || FORBIDDEN_BODY_KEYS.includes(key as never),
  )
    ? Object.keys(body).length !== 1 || !("code" in body)
    : false;
}

/** Stricter: only `code` key allowed. */
export function isSafeVerifyBody(body: Record<string, unknown>): boolean {
  const keys = Object.keys(body);
  return keys.length === 1 && keys[0] === "code" && typeof body.code === "string";
}

export function parseVerifySuccess(
  data: unknown,
  httpOk: boolean,
): { ok: true; grantExpiresAt: string } | { ok: false; errorCode?: string; retryAfterSeconds?: number } {
  if (!httpOk) {
    if (!data || typeof data !== "object") return { ok: false };
    const r = data as Record<string, unknown>;
    return {
      ok: false,
      errorCode: typeof r.errorCode === "string" ? r.errorCode : undefined,
      retryAfterSeconds:
        typeof r.retryAfterSeconds === "number" ? r.retryAfterSeconds : undefined,
    };
  }
  if (!data || typeof data !== "object") return { ok: false };
  const r = data as Record<string, unknown>;
  if (r.ok !== true || typeof r.grantExpiresAt !== "string") {
    return { ok: false };
  }
  return { ok: true, grantExpiresAt: r.grantExpiresAt };
}

function optionalStringField(value: string): string | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

export function buildCustomersRequestBody(
  submissionId: string,
  rows: QuickEntryFormRow[],
): { submissionId: string; rows: Record<string, string | null>[] } {
  return {
    submissionId,
    rows: rows.map((row) => {
      const out: Record<string, string | null> = {
        clientRowId: row.clientRowId,
        customerName: row.customerName.trim(),
        requestedProjectName: row.requestedProjectName.trim(),
        phoneCountryCode: QUICK_ENTRY_FIXED_PHONE_COUNTRY_CODE,
      };
      const phone = optionalStringField(row.phone);
      if (phone !== undefined) out.phone = phone;
      const wechatId = optionalStringField(row.wechatId);
      if (wechatId !== undefined) out.wechatId = wechatId;
      const initialFollowUpNote = optionalStringField(row.initialFollowUpNote);
      if (initialFollowUpNote !== undefined) {
        out.initialFollowUpNote = initialFollowUpNote;
      }
      const supplementalNote = optionalStringField(row.supplementalNote);
      if (supplementalNote !== undefined) out.supplementalNote = supplementalNote;
      return out;
    }),
  };
}

export function customersRequestBodyHasForbiddenKeys(
  body: Record<string, unknown>,
): boolean {
  for (const key of Object.keys(body)) {
    if (key !== "submissionId" && key !== "rows") return true;
    if (FORBIDDEN_BODY_KEYS.includes(key as never)) return true;
  }
  if (!Array.isArray(body.rows)) return true;
  for (const row of body.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return true;
    for (const key of Object.keys(row as object)) {
      if (!ALLOWED_ROW_KEYS.has(key)) return true;
      if (FORBIDDEN_ROW_KEYS.includes(key as never)) return true;
    }
  }
  return false;
}

export function validateQuickEntryFormRows(
  rows: QuickEntryFormRow[],
): QuickEntryClientValidation {
  if (rows.length === 0) {
    return { ok: false, formError: "empty", rowErrors: {} };
  }
  if (rows.length > QUICK_ENTRY_UI_MAX_ROWS) {
    return { ok: false, formError: "too_many", rowErrors: {} };
  }
  const seen = new Set<string>();
  const rowErrors: Record<string, QuickEntryClientRowError> = {};
  for (const row of rows) {
    if (!row.clientRowId || seen.has(row.clientRowId)) {
      return { ok: false, formError: "duplicate_ids", rowErrors: {} };
    }
    seen.add(row.clientRowId);
    if (!row.customerName.trim()) {
      rowErrors[row.clientRowId] = "name_required";
      continue;
    }
    if (!row.requestedProjectName.trim()) {
      rowErrors[row.clientRowId] = "project_required";
      continue;
    }
    const phone = row.phone.trim();
    const wechatId = row.wechatId.trim();
    if (!phone && !wechatId) {
      rowErrors[row.clientRowId] = "contact_required";
      continue;
    }
    if (phone && !isValidQuickEntryCnPhone(phone)) {
      rowErrors[row.clientRowId] = "phone_invalid";
    }
  }
  if (Object.keys(rowErrors).length > 0) {
    return { ok: false, rowErrors };
  }
  return { ok: true };
}

function parseRowResult(value: unknown): QuickEntryRowResultView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.clientRowId !== "string" || typeof r.status !== "string") {
    return null;
  }
  if (r.status === "created") {
    if (
      typeof r.customerId !== "string" ||
      typeof r.customerCode !== "string" ||
      typeof r.customerName !== "string"
    ) {
      return null;
    }
    return {
      clientRowId: r.clientRowId,
      status: "created",
      customerId: r.customerId,
      customerCode: r.customerCode,
      customerName: r.customerName,
    };
  }
  if (r.status === "duplicate") {
    if (typeof r.errorCode !== "string") return null;
    const duplicateField =
      r.duplicateField === "wechatId" ? "wechatId" : "phone";
    return {
      clientRowId: r.clientRowId,
      status: "duplicate",
      errorCode: r.errorCode,
      duplicateField,
    };
  }
  if (r.status === "invalid" || r.status === "failed") {
    if (typeof r.errorCode !== "string") return null;
    return {
      clientRowId: r.clientRowId,
      status: r.status,
      errorCode: r.errorCode,
    };
  }
  return null;
}

export function parseBatchSuccessResponse(
  data: unknown,
  httpOk: boolean,
): QuickEntryBatchSuccessView | null {
  if (!httpOk || !data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  if (r.ok !== true) return null;
  if (typeof r.submissionId !== "string" || typeof r.replayed !== "boolean") {
    return null;
  }
  if (!r.summary || typeof r.summary !== "object") return null;
  const s = r.summary as Record<string, unknown>;
  if (
    typeof s.total !== "number" ||
    typeof s.created !== "number" ||
    typeof s.duplicates !== "number" ||
    typeof s.invalid !== "number" ||
    typeof s.failed !== "number"
  ) {
    return null;
  }
  if (!Array.isArray(r.results)) return null;
  const results: QuickEntryRowResultView[] = [];
  for (const item of r.results) {
    const parsed = parseRowResult(item);
    if (!parsed) return null;
    results.push(parsed);
  }
  return {
    ok: true,
    submissionId: r.submissionId,
    replayed: r.replayed,
    summary: {
      total: s.total,
      created: s.created,
      duplicates: s.duplicates,
      invalid: s.invalid,
      failed: s.failed,
    },
    results,
  };
}

export function parseBatchFailureResponse(
  data: unknown,
): QuickEntryBatchFailureView {
  if (!data || typeof data !== "object") {
    return {
      ok: false,
      errorCode: "SERVER_ERROR",
      message: "server_error",
    };
  }
  const r = data as Record<string, unknown>;
  return {
    ok: false,
    errorCode:
      typeof r.errorCode === "string" ? r.errorCode : "SERVER_ERROR",
    message: typeof r.error === "string" ? r.error : "server_error",
    retryAfterSeconds:
      typeof r.retryAfterSeconds === "number"
        ? Math.max(1, Math.floor(r.retryAfterSeconds))
        : undefined,
  };
}

export type QuickEntrySubmitPlan =
  | { action: "show_results"; keepSubmissionId: true }
  | { action: "retry_same_submission"; keepSubmissionId: true; retryAfterSeconds?: number }
  | { action: "require_new_batch"; keepSubmissionId: false }
  | { action: "require_reverify"; keepSubmissionId: true }
  | { action: "feature_disabled"; keepSubmissionId: true }
  | { action: "show_safe_error"; keepSubmissionId: true };

export function planAfterBatchFailure(errorCode: string): QuickEntrySubmitPlan {
  switch (errorCode) {
    case "QUICK_ENTRY_SUBMISSION_PROCESSING":
      return { action: "retry_same_submission", keepSubmissionId: true };
    case "QUICK_ENTRY_IDEMPOTENCY_CONFLICT":
      return { action: "require_new_batch", keepSubmissionId: false };
    case "QUICK_ENTRY_GRANT_REQUIRED":
    case "QUICK_ENTRY_GRANT_EXPIRED":
    case "QUICK_ENTRY_GRANT_VERSION_MISMATCH":
      return { action: "require_reverify", keepSubmissionId: true };
    case "QUICK_ENTRY_DISABLED":
      return { action: "feature_disabled", keepSubmissionId: true };
    case "QUICK_ENTRY_SUBMISSION_LEASE_LOST":
    case "QUICK_ENTRY_SUBMISSION_ALREADY_COMPLETED":
    case "QUICK_ENTRY_SUBMISSION_ROW_CONFLICT":
    case "QUICK_ENTRY_SUBMISSION_INCOMPLETE":
      return { action: "show_safe_error", keepSubmissionId: true };
    default:
      return { action: "show_safe_error", keepSubmissionId: true };
  }
}

export function resultsContainContactPii(
  results: QuickEntryRowResultView[],
): boolean {
  const serialized = JSON.stringify(results);
  return (
    /"phone"\s*:/.test(serialized) ||
    /"wechatId"\s*:/.test(serialized) ||
    /"phoneCountryCode"\s*:/.test(serialized) ||
    /"initialFollowUpNote"\s*:/.test(serialized) ||
    /"supplementalNote"\s*:/.test(serialized)
  );
}

export function mapResultsByClientRowId(
  results: QuickEntryRowResultView[],
): Map<string, QuickEntryRowResultView> {
  const map = new Map<string, QuickEntryRowResultView>();
  for (const result of results) {
    map.set(result.clientRowId, result);
  }
  return map;
}

export function shouldShowQuickEntryEntry(status: QuickEntryStatus | null): {
  visible: boolean;
  reason: "loading" | "disabled" | "ready";
} {
  if (!status) return { visible: false, reason: "loading" };
  if (!status.enabled) return { visible: true, reason: "disabled" };
  return { visible: true, reason: "ready" };
}

export function resolveQuickEntryPanelMode(status: QuickEntryStatus): {
  mode: "locked" | "verify" | "form" | "disabled";
} {
  if (!status.enabled) return { mode: "disabled" };
  if (status.locked) return { mode: "locked" };
  if (!status.grantActive) return { mode: "verify" };
  return { mode: "form" };
}
