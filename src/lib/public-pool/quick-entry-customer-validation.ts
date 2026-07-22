import {
  hasSubstantiveContent,
  isValidCustomerName,
} from "@/lib/customers/validation";

/** Mainland China mobile: ASCII digits only, starts with 1, exactly 11 digits. */
export const QUICK_ENTRY_CN_PHONE_RE = /^1\d{10}$/;
export const QUICK_ENTRY_FIXED_PHONE_COUNTRY_CODE = "+86";

/** Practical upper bounds (SQLite TEXT has no hard limit). */
export const QUICK_ENTRY_NOTE_MAX_LENGTH = 2000;
export const QUICK_ENTRY_WECHAT_MAX_LENGTH = 64;
export const QUICK_ENTRY_NAME_MAX_LENGTH = 200;
export const QUICK_ENTRY_PROJECT_MAX_LENGTH = 200;

export const QUICK_ENTRY_CUSTOMER_ERROR_CODES = {
  CUSTOMER_NAME_REQUIRED: "QUICK_ENTRY_CUSTOMER_NAME_REQUIRED",
  CUSTOMER_NAME_INVALID: "QUICK_ENTRY_CUSTOMER_NAME_INVALID",
  CONTACT_REQUIRED: "QUICK_ENTRY_CONTACT_REQUIRED",
  PHONE_INVALID: "QUICK_ENTRY_PHONE_INVALID",
  PHONE_COUNTRY_CODE_INVALID: "QUICK_ENTRY_PHONE_COUNTRY_CODE_INVALID",
  WECHAT_INVALID: "QUICK_ENTRY_WECHAT_INVALID",
  PROJECT_REQUIRED: "QUICK_ENTRY_PROJECT_REQUIRED",
  PROJECT_INVALID: "QUICK_ENTRY_PROJECT_INVALID",
  NOTE_TOO_LONG: "QUICK_ENTRY_NOTE_TOO_LONG",
  VALIDATION_FAILED: "QUICK_ENTRY_CUSTOMER_VALIDATION_FAILED",
} as const;

export type QuickEntryCustomerInput = {
  customerName: string;
  phone?: string | null;
  phoneCountryCode?: string | null;
  wechatId?: string | null;
  requestedProjectName: string;
  initialFollowUpNote?: string | null;
  supplementalNote?: string | null;
};

/**
 * Shared canonical customer fields for hash + QE-2 create.
 * Trimmed; empty optionals → null; phoneCountryCode always set (default +86).
 */
export type QuickEntryCanonicalCustomerFields = {
  customerName: string;
  phone: string | null;
  phoneCountryCode: string;
  wechatId: string | null;
  requestedProjectName: string;
  initialFollowUpNote: string | null;
  supplementalNote: string | null;
};

export type QuickEntryCustomerNormalized = {
  customerName: string;
  phone: string | null;
  phoneCountryCode: string;
  wechatId: string | null;
  requestedProjectName: string;
  /** Maps to customers.notes */
  notes: string | null;
  /** Maps to customers.sourceRemark */
  sourceRemark: string | null;
};

export type QuickEntryValidationError = {
  field: string;
  errorCode: string;
  message: string;
};

export type QuickEntryValidationResult =
  | { ok: true; value: QuickEntryCustomerNormalized }
  | { ok: false; errors: QuickEntryValidationError[] };

function asTrimmedNullable(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Shared normalize for QE-2 validator and Batch canonical hash.
 * Does not validate business rules (name length, phone format, …).
 * phoneCountryCode: missing／null／"" → +86; any other non-empty trimmed value kept for validation.
 */
export function normalizeQuickEntryCustomerInput(
  input: QuickEntryCustomerInput,
): QuickEntryCanonicalCustomerFields {
  const customerName =
    typeof input.customerName === "string" ? input.customerName.trim() : "";
  const phone =
    typeof input.phone === "string" || input.phone == null
      ? asTrimmedNullable(input.phone)
      : null;
  const wechatId =
    typeof input.wechatId === "string" || input.wechatId == null
      ? asTrimmedNullable(input.wechatId)
      : null;

  const ccRaw =
    typeof input.phoneCountryCode === "string" || input.phoneCountryCode == null
      ? asTrimmedNullable(input.phoneCountryCode)
      : null;
  const phoneCountryCode = ccRaw ?? QUICK_ENTRY_FIXED_PHONE_COUNTRY_CODE;

  const requestedProjectName =
    typeof input.requestedProjectName === "string"
      ? input.requestedProjectName.trim()
      : "";

  const initialFollowUpNote =
    typeof input.initialFollowUpNote === "string" ||
    input.initialFollowUpNote == null
      ? asTrimmedNullable(input.initialFollowUpNote)
      : null;

  const supplementalNote =
    typeof input.supplementalNote === "string" ||
    input.supplementalNote == null
      ? asTrimmedNullable(input.supplementalNote)
      : null;

  return {
    customerName,
    phone,
    phoneCountryCode,
    wechatId,
    requestedProjectName,
    initialFollowUpNote,
    supplementalNote,
  };
}

export function canonicalToNormalizedCustomer(
  canonical: QuickEntryCanonicalCustomerFields,
): QuickEntryCustomerNormalized {
  return {
    customerName: canonical.customerName,
    phone: canonical.phone,
    phoneCountryCode: canonical.phoneCountryCode,
    wechatId: canonical.wechatId,
    requestedProjectName: canonical.requestedProjectName,
    notes: canonical.initialFollowUpNote,
    sourceRemark: canonical.supplementalNote,
  };
}

export function isValidQuickEntryCnPhone(phone: string): boolean {
  return QUICK_ENTRY_CN_PHONE_RE.test(phone);
}

/**
 * Server-side validator for public-pool quick-entry customer create.
 * Does not accept / apply Client-controlled system fields (owner/status/source/…).
 * Reuses {@link normalizeQuickEntryCustomerInput} for trim／null／country-code.
 */
export function validateQuickEntryCustomerInput(
  input: unknown,
): QuickEntryValidationResult {
  const errors: QuickEntryValidationError[] = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      errors: [
        {
          field: "input",
          errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.VALIDATION_FAILED,
          message: "输入无效",
        },
      ],
    };
  }

  const record = input as Record<string, unknown>;

  if (record.phone != null && typeof record.phone !== "string") {
    errors.push({
      field: "phone",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.PHONE_INVALID,
      message: "手机号无效",
    });
  }
  if (
    record.phoneCountryCode != null &&
    typeof record.phoneCountryCode !== "string"
  ) {
    errors.push({
      field: "phoneCountryCode",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.PHONE_COUNTRY_CODE_INVALID,
      message: "国家区号仅支持 +86",
    });
  }
  if (record.wechatId != null && typeof record.wechatId !== "string") {
    errors.push({
      field: "wechatId",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.WECHAT_INVALID,
      message: "微信号无效",
    });
  }
  if (
    record.initialFollowUpNote != null &&
    typeof record.initialFollowUpNote !== "string"
  ) {
    errors.push({
      field: "initialFollowUpNote",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.NOTE_TOO_LONG,
      message: "首次跟进备注无效",
    });
  }
  if (
    record.supplementalNote != null &&
    typeof record.supplementalNote !== "string"
  ) {
    errors.push({
      field: "supplementalNote",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.NOTE_TOO_LONG,
      message: "补充备注无效",
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const typed: QuickEntryCustomerInput = {
    customerName:
      typeof record.customerName === "string" ? record.customerName : "",
    phone:
      typeof record.phone === "string" || record.phone == null
        ? (record.phone as string | null | undefined)
        : null,
    phoneCountryCode:
      typeof record.phoneCountryCode === "string" ||
      record.phoneCountryCode == null
        ? (record.phoneCountryCode as string | null | undefined)
        : null,
    wechatId:
      typeof record.wechatId === "string" || record.wechatId == null
        ? (record.wechatId as string | null | undefined)
        : null,
    requestedProjectName:
      typeof record.requestedProjectName === "string"
        ? record.requestedProjectName
        : "",
    initialFollowUpNote:
      typeof record.initialFollowUpNote === "string" ||
      record.initialFollowUpNote == null
        ? (record.initialFollowUpNote as string | null | undefined)
        : null,
    supplementalNote:
      typeof record.supplementalNote === "string" ||
      record.supplementalNote == null
        ? (record.supplementalNote as string | null | undefined)
        : null,
  };

  const canonical = normalizeQuickEntryCustomerInput(typed);

  if (!canonical.customerName) {
    errors.push({
      field: "customerName",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.CUSTOMER_NAME_REQUIRED,
      message: "客户名称必填",
    });
  } else if (
    canonical.customerName.length > QUICK_ENTRY_NAME_MAX_LENGTH ||
    !isValidCustomerName(canonical.customerName)
  ) {
    errors.push({
      field: "customerName",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.CUSTOMER_NAME_INVALID,
      message:
        "请输入有效的客户姓名。中文姓名至少 2 个汉字；英文姓名至少 4 个英文字母",
    });
  }

  if (canonical.phoneCountryCode !== QUICK_ENTRY_FIXED_PHONE_COUNTRY_CODE) {
    errors.push({
      field: "phoneCountryCode",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.PHONE_COUNTRY_CODE_INVALID,
      message: "国家区号仅支持 +86",
    });
  }

  if (!canonical.phone && !canonical.wechatId) {
    errors.push({
      field: "phone",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.CONTACT_REQUIRED,
      message: "请至少填写手机号或微信号",
    });
  }

  if (canonical.phone && !isValidQuickEntryCnPhone(canonical.phone)) {
    errors.push({
      field: "phone",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.PHONE_INVALID,
      message: "电话必须为1开头的11位数字",
    });
  }

  if (
    canonical.wechatId &&
    canonical.wechatId.length > QUICK_ENTRY_WECHAT_MAX_LENGTH
  ) {
    errors.push({
      field: "wechatId",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.WECHAT_INVALID,
      message: "微信号过长",
    });
  }

  if (!canonical.requestedProjectName) {
    errors.push({
      field: "requestedProjectName",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.PROJECT_REQUIRED,
      message: "客户需要的项目名称必填",
    });
  } else if (
    canonical.requestedProjectName.length > QUICK_ENTRY_PROJECT_MAX_LENGTH ||
    !hasSubstantiveContent(canonical.requestedProjectName, 4)
  ) {
    errors.push({
      field: "requestedProjectName",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.PROJECT_INVALID,
      message: "项目名称至少 4 个字，且不能只填符号",
    });
  }

  if (
    canonical.initialFollowUpNote &&
    canonical.initialFollowUpNote.length > QUICK_ENTRY_NOTE_MAX_LENGTH
  ) {
    errors.push({
      field: "initialFollowUpNote",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.NOTE_TOO_LONG,
      message: "首次跟进备注过长",
    });
  }

  if (
    canonical.supplementalNote &&
    canonical.supplementalNote.length > QUICK_ENTRY_NOTE_MAX_LENGTH
  ) {
    errors.push({
      field: "supplementalNote",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.NOTE_TOO_LONG,
      message: "补充备注过长",
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: canonicalToNormalizedCustomer({
      ...canonical,
      phoneCountryCode: QUICK_ENTRY_FIXED_PHONE_COUNTRY_CODE,
    }),
  };
}
