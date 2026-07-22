import {
  hasSubstantiveContent,
  isValidCustomerName,
} from "@/lib/customers/validation";

const CN_PHONE_RE = /^1\d{10}$/;

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
 * Server-side validator for public-pool quick-entry customer create.
 * Does not accept / apply Client-controlled system fields (owner/status/source/…).
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

  const customerNameRaw =
    typeof record.customerName === "string" ? record.customerName.trim() : "";
  if (!customerNameRaw) {
    errors.push({
      field: "customerName",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.CUSTOMER_NAME_REQUIRED,
      message: "客户名称必填",
    });
  } else if (
    customerNameRaw.length > QUICK_ENTRY_NAME_MAX_LENGTH ||
    !isValidCustomerName(customerNameRaw)
  ) {
    errors.push({
      field: "customerName",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.CUSTOMER_NAME_INVALID,
      message:
        "请输入有效的客户姓名。中文姓名至少 2 个汉字；英文姓名至少 4 个英文字母",
    });
  }

  const phone =
    typeof record.phone === "string" || record.phone == null
      ? asTrimmedNullable(record.phone)
      : null;
  if (record.phone != null && typeof record.phone !== "string") {
    errors.push({
      field: "phone",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.PHONE_INVALID,
      message: "手机号无效",
    });
  }

  const wechatId =
    typeof record.wechatId === "string" || record.wechatId == null
      ? asTrimmedNullable(record.wechatId)
      : null;
  if (record.wechatId != null && typeof record.wechatId !== "string") {
    errors.push({
      field: "wechatId",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.WECHAT_INVALID,
      message: "微信号无效",
    });
  }

  if (!phone && !wechatId) {
    errors.push({
      field: "phone",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.CONTACT_REQUIRED,
      message: "请至少填写手机号或微信号",
    });
  }

  let phoneCountryCode = "+86";
  if (phone) {
    const ccRaw =
      typeof record.phoneCountryCode === "string"
        ? record.phoneCountryCode.trim()
        : "";
    phoneCountryCode = ccRaw || "+86";
    if (phoneCountryCode === "+86" && !CN_PHONE_RE.test(phone)) {
      errors.push({
        field: "phone",
        errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.PHONE_INVALID,
        message: "+86 手机号必须为 11 位数字，且以 1 开头",
      });
    }
  }

  if (wechatId && wechatId.length > QUICK_ENTRY_WECHAT_MAX_LENGTH) {
    errors.push({
      field: "wechatId",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.WECHAT_INVALID,
      message: "微信号过长",
    });
  }

  const requestedProjectName =
    typeof record.requestedProjectName === "string"
      ? record.requestedProjectName.trim()
      : "";
  if (!requestedProjectName) {
    errors.push({
      field: "requestedProjectName",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.PROJECT_REQUIRED,
      message: "客户需要的项目名称必填",
    });
  } else if (
    requestedProjectName.length > QUICK_ENTRY_PROJECT_MAX_LENGTH ||
    !hasSubstantiveContent(requestedProjectName, 4)
  ) {
    errors.push({
      field: "requestedProjectName",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.PROJECT_INVALID,
      message: "项目名称至少 4 个字，且不能只填符号",
    });
  }

  const notes =
    typeof record.initialFollowUpNote === "string" ||
    record.initialFollowUpNote == null
      ? asTrimmedNullable(record.initialFollowUpNote)
      : null;
  if (
    record.initialFollowUpNote != null &&
    typeof record.initialFollowUpNote !== "string"
  ) {
    errors.push({
      field: "initialFollowUpNote",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.NOTE_TOO_LONG,
      message: "首次跟进备注无效",
    });
  } else if (notes && notes.length > QUICK_ENTRY_NOTE_MAX_LENGTH) {
    errors.push({
      field: "initialFollowUpNote",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.NOTE_TOO_LONG,
      message: "首次跟进备注过长",
    });
  }

  const sourceRemark =
    typeof record.supplementalNote === "string" ||
    record.supplementalNote == null
      ? asTrimmedNullable(record.supplementalNote)
      : null;
  if (
    record.supplementalNote != null &&
    typeof record.supplementalNote !== "string"
  ) {
    errors.push({
      field: "supplementalNote",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.NOTE_TOO_LONG,
      message: "补充备注无效",
    });
  } else if (sourceRemark && sourceRemark.length > QUICK_ENTRY_NOTE_MAX_LENGTH) {
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
    value: {
      customerName: customerNameRaw,
      phone,
      phoneCountryCode,
      wechatId,
      requestedProjectName,
      notes,
      sourceRemark,
    },
  };
}
