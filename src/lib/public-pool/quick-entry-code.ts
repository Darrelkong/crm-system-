import {
  QUICK_ENTRY_CODE_MAX_LENGTH,
  QUICK_ENTRY_CODE_MIN_LENGTH,
  QUICK_ENTRY_ERROR_CODES,
} from "@/lib/public-pool/quick-entry-constants";

export type QuickEntryCodeFormatResult =
  | { ok: true; code: string }
  | { ok: false; errorCode: typeof QUICK_ENTRY_ERROR_CODES.CODE_INVALID_FORMAT };

/**
 * Server-side format check for the entry code.
 * Does not log or return the code on failure.
 */
export function validateQuickEntryCodeFormat(
  value: unknown,
): QuickEntryCodeFormatResult {
  if (typeof value !== "string") {
    return { ok: false, errorCode: QUICK_ENTRY_ERROR_CODES.CODE_INVALID_FORMAT };
  }
  if (value !== value.trim()) {
    return { ok: false, errorCode: QUICK_ENTRY_ERROR_CODES.CODE_INVALID_FORMAT };
  }
  if (
    value.length < QUICK_ENTRY_CODE_MIN_LENGTH ||
    value.length > QUICK_ENTRY_CODE_MAX_LENGTH
  ) {
    return { ok: false, errorCode: QUICK_ENTRY_ERROR_CODES.CODE_INVALID_FORMAT };
  }
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    return { ok: false, errorCode: QUICK_ENTRY_ERROR_CODES.CODE_INVALID_FORMAT };
  }
  return { ok: true, code: value };
}

/** True when body is oversized / clearly not a candidate code string. */
export function isQuickEntryCodeBodyRejectable(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== "string") return true;
  if (value.length > QUICK_ENTRY_CODE_MAX_LENGTH) return true;
  return false;
}
