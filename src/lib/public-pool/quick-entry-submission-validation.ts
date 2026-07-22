import {
  QUICK_ENTRY_CLIENT_ROW_ID_MAX_LENGTH,
  QUICK_ENTRY_CLIENT_ROW_ID_RE,
  QUICK_ENTRY_SUBMISSION_ERROR_CODES,
  QUICK_ENTRY_SUBMISSION_ID_UUID_V4_RE,
} from "@/lib/public-pool/quick-entry-submission-constants";

export type QuickEntryIdValidationResult =
  | { ok: true; value: string }
  | { ok: false; errorCode: string; message: string };

/**
 * Validates Client-provided submissionId (UUID v4).
 * Does not trim — leading/trailing whitespace is invalid.
 */
export function validateQuickEntrySubmissionId(
  value: unknown,
): QuickEntryIdValidationResult {
  if (typeof value !== "string") {
    return {
      ok: false,
      errorCode: QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_ID_INVALID,
      message: "submissionId 无效",
    };
  }
  if (value.trim() !== value) {
    return {
      ok: false,
      errorCode: QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_ID_INVALID,
      message: "submissionId 无效",
    };
  }
  if (value.length !== 36 || !QUICK_ENTRY_SUBMISSION_ID_UUID_V4_RE.test(value)) {
    return {
      ok: false,
      errorCode: QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_ID_INVALID,
      message: "submissionId 必须为 UUID v4",
    };
  }
  return { ok: true, value };
}

/**
 * Validates Client-provided clientRowId (1–64 of [A-Za-z0-9_-]).
 */
export function validateQuickEntryClientRowId(
  value: unknown,
): QuickEntryIdValidationResult {
  if (typeof value !== "string") {
    return {
      ok: false,
      errorCode: QUICK_ENTRY_SUBMISSION_ERROR_CODES.CLIENT_ROW_ID_INVALID,
      message: "clientRowId 无效",
    };
  }
  if (value.length < 1 || value.length > QUICK_ENTRY_CLIENT_ROW_ID_MAX_LENGTH) {
    return {
      ok: false,
      errorCode: QUICK_ENTRY_SUBMISSION_ERROR_CODES.CLIENT_ROW_ID_INVALID,
      message: "clientRowId 长度无效",
    };
  }
  if (!QUICK_ENTRY_CLIENT_ROW_ID_RE.test(value)) {
    return {
      ok: false,
      errorCode: QUICK_ENTRY_SUBMISSION_ERROR_CODES.CLIENT_ROW_ID_INVALID,
      message: "clientRowId 格式无效",
    };
  }
  return { ok: true, value };
}
