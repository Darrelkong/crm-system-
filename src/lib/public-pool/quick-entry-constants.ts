/** Session-bound grant lifetime after successful code verify. */
export const QUICK_ENTRY_GRANT_DURATION_MS = 30 * 60 * 1000;
export const QUICK_ENTRY_GRANT_DURATION_SECONDS = 1800;

/** Consecutive wrong verifies on the same CRM session before lockout. */
export const QUICK_ENTRY_MAX_FAILED_ATTEMPTS = 5;

/** Lockout duration after the 5th failed attempt. */
export const QUICK_ENTRY_LOCK_DURATION_MS = 15 * 60 * 1000;
export const QUICK_ENTRY_LOCK_DURATION_SECONDS = 900;

export const QUICK_ENTRY_CODE_MIN_LENGTH = 8;
export const QUICK_ENTRY_CODE_MAX_LENGTH = 64;

/** Dedicated system_settings keys — never add to generic SETTING_KEYS. */
export const QUICK_ENTRY_SETTING_KEYS = {
  enabled: "public_pool_quick_entry_enabled",
  codeHash: "public_pool_quick_entry_code_hash",
  codeUpdatedAt: "public_pool_quick_entry_code_updated_at",
  codeUpdatedBy: "public_pool_quick_entry_code_updated_by",
  grantVersion: "public_pool_quick_entry_grant_version",
} as const;

export const QUICK_ENTRY_ERROR_CODES = {
  CODE_INVALID_FORMAT: "QUICK_ENTRY_CODE_INVALID_FORMAT",
  CODE_CONFIRMATION_MISMATCH: "QUICK_ENTRY_CODE_CONFIRMATION_MISMATCH",
  CODE_NOT_CONFIGURED: "QUICK_ENTRY_CODE_NOT_CONFIGURED",
  CODE_INVALID: "QUICK_ENTRY_CODE_INVALID",
  DISABLED: "QUICK_ENTRY_DISABLED",
  RATE_LIMITED: "QUICK_ENTRY_RATE_LIMITED",
  VALIDATION_ERROR: "VALIDATION_ERROR",
} as const;
