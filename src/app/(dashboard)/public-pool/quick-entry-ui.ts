/**
 * Pure helpers for Public Pool Quick Entry staff UI.
 * No React — fully unit-testable. Server remains the authority.
 */

import { hasSubstantiveContent } from "@/lib/customers/validation";
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

/** Frontend convenience suggestions only — still submitted as a plain string. */
export const QUICK_ENTRY_PROJECT_SUGGESTIONS = [
  "美國個人銀行開戶",
  "美國企業銀行開戶",
  "香港個人銀行開戶",
  "香港公司銀行開戶",
  "ITIN申請",
  "海外身份規劃",
  "香港身份",
  "企業服務",
  "其他",
] as const;

export type QuickEntryEntryMode = "single" | "batch";

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
  | "project_invalid"
  | "contact_required"
  | "phone_invalid";

export type QuickEntryFieldKey =
  | "customerName"
  | "requestedProjectName"
  | "phone"
  | "wechatId"
  | "contact";

export type QuickEntryFieldErrors = Partial<
  Record<QuickEntryFieldKey, QuickEntryClientRowError>
>;

export type QuickEntryClientValidation =
  | { ok: true }
  | {
      ok: false;
      formError?: "empty" | "too_many" | "duplicate_ids";
      /** First error per row (batch summary / backward compatible). */
      rowErrors: Record<string, QuickEntryClientRowError>;
      /** Field-level errors keyed by clientRowId. */
      fieldErrors: Record<string, QuickEntryFieldErrors>;
    };

export type QuickEntrySingleResultKind =
  | "success"
  | "duplicate"
  | "invalid"
  | "failed"
  | "mixed";

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

export function isQuickEntryRowDirty(row: QuickEntryFormRow): boolean {
  return Boolean(
    row.customerName.trim() ||
      row.phone.trim() ||
      row.wechatId.trim() ||
      row.requestedProjectName.trim() ||
      row.initialFollowUpNote.trim() ||
      row.supplementalNote.trim(),
  );
}

export function isQuickEntryBatchDirty(rows: QuickEntryFormRow[]): boolean {
  return rows.some(isQuickEntryRowDirty);
}

/**
 * Prepare the next single-entry draft after a successful "save and continue".
 * Always allocates a new clientRowId; optionally keeps the project name.
 */
export function prepareContinueEntryRow(
  previous: QuickEntryFormRow,
  keepProject: boolean,
  randomUuid: () => string = () => crypto.randomUUID(),
): QuickEntryFormRow {
  const next = createEmptyQuickEntryRow(randomUuid);
  if (keepProject) {
    next.requestedProjectName = previous.requestedProjectName;
  }
  return next;
}

export function filterProjectSuggestions(
  query: string,
  suggestions: readonly string[] = QUICK_ENTRY_PROJECT_SUGGESTIONS,
): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...suggestions];
  return suggestions.filter((item) => item.toLowerCase().includes(q));
}

export function deriveSingleEntryResultKind(
  result: QuickEntryRowResultView | null | undefined,
): QuickEntrySingleResultKind | null {
  if (!result) return null;
  if (result.status === "created") return "success";
  if (result.status === "duplicate") return "duplicate";
  if (result.status === "invalid") return "invalid";
  return "failed";
}

const FIELD_ERROR_PRIORITY: QuickEntryFieldKey[] = [
  "customerName",
  "requestedProjectName",
  "phone",
  "contact",
  "wechatId",
];

export function firstFieldErrorKey(
  errors: QuickEntryFieldErrors | undefined,
): QuickEntryFieldKey | null {
  if (!errors) return null;
  for (const key of FIELD_ERROR_PRIORITY) {
    if (errors[key]) return key;
  }
  return null;
}

function validateOneQuickEntryRow(row: QuickEntryFormRow): QuickEntryFieldErrors {
  const errors: QuickEntryFieldErrors = {};
  if (!row.customerName.trim()) {
    errors.customerName = "name_required";
  }
  const project = row.requestedProjectName.trim();
  if (!project) {
    errors.requestedProjectName = "project_required";
  } else if (!hasSubstantiveContent(project, 4)) {
    errors.requestedProjectName = "project_invalid";
  }
  const phone = row.phone.trim();
  const wechatId = row.wechatId.trim();
  if (!phone && !wechatId) {
    errors.contact = "contact_required";
  } else if (phone && !isValidQuickEntryCnPhone(phone)) {
    errors.phone = "phone_invalid";
  }
  return errors;
}

function firstRowErrorFromFields(
  errors: QuickEntryFieldErrors,
): QuickEntryClientRowError | null {
  for (const key of FIELD_ERROR_PRIORITY) {
    const err = errors[key];
    if (err) return err;
  }
  return null;
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
    return { ok: false, formError: "empty", rowErrors: {}, fieldErrors: {} };
  }
  if (rows.length > QUICK_ENTRY_UI_MAX_ROWS) {
    return { ok: false, formError: "too_many", rowErrors: {}, fieldErrors: {} };
  }
  const seen = new Set<string>();
  const rowErrors: Record<string, QuickEntryClientRowError> = {};
  const fieldErrors: Record<string, QuickEntryFieldErrors> = {};
  for (const row of rows) {
    if (!row.clientRowId || seen.has(row.clientRowId)) {
      return {
        ok: false,
        formError: "duplicate_ids",
        rowErrors: {},
        fieldErrors: {},
      };
    }
    seen.add(row.clientRowId);
    const fields = validateOneQuickEntryRow(row);
    if (Object.keys(fields).length > 0) {
      fieldErrors[row.clientRowId] = fields;
      const first = firstRowErrorFromFields(fields);
      if (first) rowErrors[row.clientRowId] = first;
    }
  }
  if (Object.keys(rowErrors).length > 0) {
    return { ok: false, rowErrors, fieldErrors };
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

/** Field errors for one row — shared by single and batch accordion. */
export function getQuickEntryRowFieldErrors(
  row: QuickEntryFormRow,
): QuickEntryFieldErrors {
  return validateOneQuickEntryRow(row);
}

export type QuickEntryCardBadge =
  | "incomplete"
  | "ready"
  | "error"
  | "submitting"
  | "created"
  | "duplicate"
  | "invalid"
  | "failed";

export type QuickEntryCardSummary = {
  nameEmpty: boolean;
  nameText: string;
  contactKind: "phone" | "wechat" | "empty";
  contactText: string;
  projectEmpty: boolean;
  projectText: string;
};

export function buildQuickEntryCardSummary(
  row: QuickEntryFormRow,
): QuickEntryCardSummary {
  const nameText = row.customerName.trim();
  const phone = row.phone.trim();
  const wechatId = row.wechatId.trim();
  const projectText = row.requestedProjectName.trim();
  let contactKind: QuickEntryCardSummary["contactKind"] = "empty";
  let contactText = "";
  if (phone) {
    contactKind = "phone";
    contactText = `${QUICK_ENTRY_FIXED_PHONE_COUNTRY_CODE}${phone}`;
  } else if (wechatId) {
    contactKind = "wechat";
    contactText = wechatId;
  }
  return {
    nameEmpty: !nameText,
    nameText,
    contactKind,
    contactText,
    projectEmpty: !projectText,
    projectText,
  };
}

export function deriveQuickEntryCardBadge(
  row: QuickEntryFormRow,
  options: {
    submitting?: boolean;
    hasFieldErrors?: boolean;
    result?: QuickEntryRowResultView | null;
  } = {},
): QuickEntryCardBadge {
  if (options.result) {
    if (options.result.status === "created") return "created";
    if (options.result.status === "duplicate") return "duplicate";
    if (options.result.status === "invalid") return "invalid";
    return "failed";
  }
  if (options.submitting) return "submitting";
  if (options.hasFieldErrors) return "error";
  const errors = validateOneQuickEntryRow(row);
  if (Object.keys(errors).length === 0) return "ready";
  return "incomplete";
}

export function initialAccordionOpenIds(
  rows: QuickEntryFormRow[],
): string[] {
  const first = rows[0]?.clientRowId;
  return first ? [first] : [];
}

export function firstErrorClientRowId(
  fieldErrors: Record<string, QuickEntryFieldErrors>,
  rowOrder: QuickEntryFormRow[],
): string | null {
  for (const row of rowOrder) {
    if (fieldErrors[row.clientRowId] && Object.keys(fieldErrors[row.clientRowId]!).length > 0) {
      return row.clientRowId;
    }
  }
  const keys = Object.keys(fieldErrors);
  return keys[0] ?? null;
}

export function countFieldErrorRows(
  fieldErrors: Record<string, QuickEntryFieldErrors>,
): number {
  return Object.values(fieldErrors).filter((e) => Object.keys(e).length > 0)
    .length;
}

export type QuickEntryModeSwitchReason =
  | "direct"
  | "single_to_batch_dirty"
  | "batch_one_to_single"
  | "batch_multi_to_single"
  | "blocked_submitting";

export type QuickEntryModeSwitchPlan =
  | { action: "direct"; nextRows: QuickEntryFormRow[] }
  | {
      action: "confirm";
      reason: Exclude<
        QuickEntryModeSwitchReason,
        "direct" | "blocked_submitting"
      >;
      dirtyCount: number;
    }
  | { action: "blocked_submitting" };

export function planQuickEntryModeSwitch(
  from: QuickEntryEntryMode,
  to: QuickEntryEntryMode,
  rows: QuickEntryFormRow[],
  submitting: boolean,
): QuickEntryModeSwitchPlan {
  if (from === to) {
    return { action: "direct", nextRows: rows };
  }
  if (submitting) return { action: "blocked_submitting" };

  const dirtyRows = rows.filter(isQuickEntryRowDirty);
  const dirtyCount = dirtyRows.length;

  if (from === "single" && to === "batch") {
    if (dirtyCount === 0) {
      return {
        action: "direct",
        nextRows: rows.length > 0 ? rows : [createEmptyQuickEntryRow()],
      };
    }
    return { action: "confirm", reason: "single_to_batch_dirty", dirtyCount };
  }

  if (from === "batch" && to === "single") {
    if (dirtyCount === 0) {
      return {
        action: "direct",
        nextRows: [rows[0] ? clearQuickEntryRow(rows[0]) : createEmptyQuickEntryRow()],
      };
    }
    if (dirtyCount === 1 && rows.length === 1) {
      return { action: "direct", nextRows: [rows[0]!] };
    }
    if (dirtyCount === 1 && rows.filter(isQuickEntryRowDirty).length === 1) {
      const only = rows.find(isQuickEntryRowDirty)!;
      return { action: "direct", nextRows: [only] };
    }
    return { action: "confirm", reason: "batch_multi_to_single", dirtyCount };
  }

  return { action: "direct", nextRows: rows };
}

export type QuickEntryModeSwitchChoice =
  | "keep_first"
  | "keep_as_batch_first"
  | "discard"
  | "cancel";

export function applyQuickEntryModeSwitchChoice(
  to: QuickEntryEntryMode,
  reason: Exclude<QuickEntryModeSwitchReason, "direct" | "blocked_submitting">,
  choice: QuickEntryModeSwitchChoice,
  rows: QuickEntryFormRow[],
): { entryMode: QuickEntryEntryMode; rows: QuickEntryFormRow[] } | null {
  if (choice === "cancel") return null;

  if (reason === "single_to_batch_dirty") {
    if (choice === "keep_as_batch_first" || choice === "keep_first") {
      return {
        entryMode: "batch",
        rows: rows[0] ? [rows[0]] : [createEmptyQuickEntryRow()],
      };
    }
    if (choice === "discard") {
      return { entryMode: "batch", rows: [createEmptyQuickEntryRow()] };
    }
  }

  if (reason === "batch_multi_to_single" || reason === "batch_one_to_single") {
    if (choice === "keep_first") {
      return {
        entryMode: "single",
        rows: [rows[0] ?? createEmptyQuickEntryRow()],
      };
    }
    if (choice === "discard") {
      return { entryMode: "single", rows: [createEmptyQuickEntryRow()] };
    }
  }

  return { entryMode: to, rows };
}

/** Clone rows with fresh clientRowIds for a new submission after return-to-edit. */
export function cloneRowsWithNewClientRowIds(
  rows: QuickEntryFormRow[],
  randomUuid: () => string = () => crypto.randomUUID(),
): QuickEntryFormRow[] {
  return rows.map((row) => ({
    ...row,
    clientRowId: createQuickEntryClientRowId(randomUuid),
    phoneCountryCode: QUICK_ENTRY_FIXED_PHONE_COUNTRY_CODE,
  }));
}

/** Keep only rows that were not successfully created (for retry after partial batch). */
export function filterIncompleteRowsForRetry(
  rows: QuickEntryFormRow[],
  results: QuickEntryRowResultView[],
): QuickEntryFormRow[] {
  const byId = mapResultsByClientRowId(results);
  return rows.filter((row) => {
    const result = byId.get(row.clientRowId);
    return !result || result.status !== "created";
  });
}

export function prepareRetryBatchFromIncomplete(
  rows: QuickEntryFormRow[],
  results: QuickEntryRowResultView[],
  randomUuid: () => string = () => crypto.randomUUID(),
): { submissionId: string; rows: QuickEntryFormRow[] } {
  const incomplete = filterIncompleteRowsForRetry(rows, results);
  const source =
    incomplete.length > 0 ? incomplete : [createEmptyQuickEntryRow(randomUuid)];
  return {
    submissionId: createQuickEntrySubmissionId(randomUuid),
    rows: cloneRowsWithNewClientRowIds(source, randomUuid),
  };
}

export type QuickEntryViewport = "mobile" | "tablet" | "desktop";

/** Pure layout hints for Desktop / Tablet / Mobile shell structure. */
export function resolveQuickEntryLayout(viewport: QuickEntryViewport): {
  shell: "sheet" | "drawer";
  panelWidthHint: string;
  formColumns: 1 | 2;
  accordionDefaultOpenCount: number;
} {
  if (viewport === "mobile") {
    return {
      shell: "sheet",
      panelWidthHint: "100vw",
      formColumns: 1,
      accordionDefaultOpenCount: 1,
    };
  }
  if (viewport === "tablet") {
    return {
      shell: "drawer",
      panelWidthHint: "70vw-80vw",
      formColumns: 2,
      accordionDefaultOpenCount: 1,
    };
  }
  return {
    shell: "drawer",
    panelWidthHint: "520px-600px",
    formColumns: 2,
    accordionDefaultOpenCount: 1,
  };
}

export function shouldConfirmDeleteQuickEntryRow(
  row: QuickEntryFormRow,
): boolean {
  return isQuickEntryRowDirty(row);
}
