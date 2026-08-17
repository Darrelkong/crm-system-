import {
  isCustomerNameStatus,
  isPendingNamePlaceholder,
  type CustomerNameStatus,
} from "@/lib/customers/name-status";
import { CUSTOMER_SOURCE_OTHER_KEY } from "@/lib/constants/customer-sources";
import { assertWritableCustomerSourceKey } from "@/lib/customer-sources/keys";
import { resolveRequestedProjectForPersist } from "@/lib/customers/requested-project-resolve";
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

/**
 * Confirmed-name format for Quick Entry — same rules as create/edit
 * ({@link isValidCustomerName}: Chinese 1–5, or Latin ≥4).
 * Pending placeholders must be accepted via nameStatus=pending instead.
 */
export function isValidQuickEntryCustomerName(name: string): boolean {
  return isValidCustomerName(name);
}

export const QUICK_ENTRY_CUSTOMER_ERROR_CODES = {
  CUSTOMER_NAME_REQUIRED: "QUICK_ENTRY_CUSTOMER_NAME_REQUIRED",
  CUSTOMER_NAME_INVALID: "QUICK_ENTRY_CUSTOMER_NAME_INVALID",
  CUSTOMER_NAME_PLACEHOLDER_FORBIDDEN:
    "QUICK_ENTRY_CUSTOMER_NAME_PLACEHOLDER_FORBIDDEN",
  CONTACT_REQUIRED: "QUICK_ENTRY_CONTACT_REQUIRED",
  PHONE_INVALID: "QUICK_ENTRY_PHONE_INVALID",
  PHONE_COUNTRY_CODE_INVALID: "QUICK_ENTRY_PHONE_COUNTRY_CODE_INVALID",
  WECHAT_INVALID: "QUICK_ENTRY_WECHAT_INVALID",
  PROJECT_REQUIRED: "QUICK_ENTRY_PROJECT_REQUIRED",
  PROJECT_INVALID: "QUICK_ENTRY_PROJECT_INVALID",
  NOTE_TOO_LONG: "QUICK_ENTRY_NOTE_TOO_LONG",
  SOURCE_REQUIRED: "QUICK_ENTRY_SOURCE_REQUIRED",
  SOURCE_INVALID: "QUICK_ENTRY_SOURCE_INVALID",
  SOURCE_REMARK_REQUIRED: "QUICK_ENTRY_SOURCE_REMARK_REQUIRED",
  VALIDATION_FAILED: "QUICK_ENTRY_CUSTOMER_VALIDATION_FAILED",
} as const;

export type QuickEntryCustomerInput = {
  customerName: string;
  /** Create-aligned; omit / confirmed = real name. Pending requires exact placeholder. */
  nameStatus?: CustomerNameStatus | null;
  phone?: string | null;
  phoneCountryCode?: string | null;
  wechatId?: string | null;
  /** Optional; checked for duplicates when present. Not shown in QE UI yet. */
  email?: string | null;
  /** Catalog code (required for new QE creates). */
  requestedProjectCode?: string | null;
  /** Required when code is `other`; ignored for standard catalog codes. */
  requestedProjectName?: string | null;
  /** Real customer source leaf key (required for Phase 2+). */
  source?: string | null;
  initialFollowUpNote?: string | null;
  supplementalNote?: string | null;
};

/**
 * Shared canonical customer fields for hash + QE create.
 * Trimmed; empty optionals → null; phoneCountryCode always set (default +86).
 */
export type QuickEntryCanonicalCustomerFields = {
  customerName: string;
  nameStatus: CustomerNameStatus;
  phone: string | null;
  phoneCountryCode: string;
  wechatId: string | null;
  email: string | null;
  requestedProjectCode: string;
  requestedProjectName: string;
  source: string;
  initialFollowUpNote: string | null;
  supplementalNote: string | null;
};

export type QuickEntryCustomerNormalized = {
  customerName: string;
  nameStatus: CustomerNameStatus;
  phone: string | null;
  phoneCountryCode: string;
  wechatId: string | null;
  email: string | null;
  requestedProjectCode: string;
  requestedProjectName: string;
  source: string;
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
 * Shared normalize for QE validator and Batch canonical hash.
 * Does not validate business rules (name length, phone format, …).
 * phoneCountryCode: missing／null／"" → +86; any other non-empty trimmed value kept for validation.
 */
export function normalizeQuickEntryCustomerInput(
  input: QuickEntryCustomerInput,
): Omit<
  QuickEntryCanonicalCustomerFields,
  "requestedProjectCode"
> & {
  requestedProjectCode: string;
} {
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

  const email =
    typeof input.email === "string" || input.email == null
      ? asTrimmedNullable(input.email)
      : null;

  const ccRaw =
    typeof input.phoneCountryCode === "string" || input.phoneCountryCode == null
      ? asTrimmedNullable(input.phoneCountryCode)
      : null;
  const phoneCountryCode = ccRaw ?? QUICK_ENTRY_FIXED_PHONE_COUNTRY_CODE;

  const nameStatus: CustomerNameStatus =
    input.nameStatus === "pending" ? "pending" : "confirmed";

  const requestedProjectCode =
    typeof input.requestedProjectCode === "string"
      ? input.requestedProjectCode.trim()
      : "";

  const requestedProjectName =
    typeof input.requestedProjectName === "string"
      ? input.requestedProjectName.trim()
      : "";

  const source =
    typeof input.source === "string" ? input.source.trim() : "";

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
    nameStatus,
    phone,
    phoneCountryCode,
    wechatId,
    email,
    requestedProjectCode,
    requestedProjectName,
    source,
    initialFollowUpNote,
    supplementalNote,
  };
}

export function canonicalToNormalizedCustomer(
  canonical: QuickEntryCanonicalCustomerFields,
): QuickEntryCustomerNormalized {
  return {
    customerName: canonical.customerName,
    nameStatus: canonical.nameStatus,
    phone: canonical.phone,
    phoneCountryCode: canonical.phoneCountryCode,
    wechatId: canonical.wechatId,
    email: canonical.email,
    requestedProjectCode: canonical.requestedProjectCode,
    requestedProjectName: canonical.requestedProjectName,
    source: canonical.source,
    notes: canonical.initialFollowUpNote,
    sourceRemark: canonical.supplementalNote,
  };
}

export function isValidQuickEntryCnPhone(phone: string): boolean {
  return QUICK_ENTRY_CN_PHONE_RE.test(phone);
}

export function validateQuickEntryCustomerSourceKey(
  source: string | null | undefined,
  selectableKeys: readonly string[],
): QuickEntryValidationError | null {
  const trimmed = typeof source === "string" ? source.trim() : "";
  if (!trimmed) {
    return {
      field: "source",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.SOURCE_REQUIRED,
      message: "请选择客户来源",
    };
  }
  if (!assertWritableCustomerSourceKey(trimmed, selectableKeys)) {
    return {
      field: "source",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.SOURCE_INVALID,
      message: "请从固定字典选择客户来源",
    };
  }
  return null;
}

/**
 * Server-side validator for public-pool quick-entry customer create.
 * Aligns name + requested-project rules with full customer create.
 */
export function validateQuickEntryCustomerInput(
  input: unknown,
  options?: { selectableSourceKeys?: readonly string[] },
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
  if (record.source != null && typeof record.source !== "string") {
    errors.push({
      field: "source",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.SOURCE_INVALID,
      message: "客户来源无效",
    });
  }
  if (
    record.nameStatus != null &&
    typeof record.nameStatus === "string" &&
    !isCustomerNameStatus(record.nameStatus)
  ) {
    errors.push({
      field: "customerName",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.CUSTOMER_NAME_INVALID,
      message: "姓名状态无效",
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const typed: QuickEntryCustomerInput = {
    customerName:
      typeof record.customerName === "string" ? record.customerName : "",
    nameStatus:
      record.nameStatus === "pending" || record.nameStatus === "confirmed"
        ? record.nameStatus
        : "confirmed",
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
    email:
      typeof record.email === "string" || record.email == null
        ? (record.email as string | null | undefined)
        : null,
    requestedProjectCode:
      typeof record.requestedProjectCode === "string" ||
      record.requestedProjectCode == null
        ? (record.requestedProjectCode as string | null | undefined)
        : null,
    requestedProjectName:
      typeof record.requestedProjectName === "string"
        ? record.requestedProjectName
        : "",
    source:
      typeof record.source === "string" || record.source == null
        ? (record.source as string | null | undefined)
        : null,
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

  if (canonical.nameStatus === "pending") {
    if (!canonical.customerName) {
      errors.push({
        field: "customerName",
        errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.CUSTOMER_NAME_REQUIRED,
        message: "请选择 X先生 或 X女士",
      });
    } else if (!isPendingNamePlaceholder(canonical.customerName)) {
      errors.push({
        field: "customerName",
        errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.CUSTOMER_NAME_INVALID,
        message: "请选择 X先生 或 X女士",
      });
    }
  } else if (!canonical.customerName) {
    errors.push({
      field: "customerName",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.CUSTOMER_NAME_REQUIRED,
      message: "客户名称必填",
    });
  } else if (isPendingNamePlaceholder(canonical.customerName)) {
    errors.push({
      field: "customerName",
      errorCode:
        QUICK_ENTRY_CUSTOMER_ERROR_CODES.CUSTOMER_NAME_PLACEHOLDER_FORBIDDEN,
      message: "X先生／X女士仅可在「暂时不知道姓名」时使用",
    });
  } else if (
    canonical.customerName.length > QUICK_ENTRY_NAME_MAX_LENGTH ||
    !isValidQuickEntryCustomerName(canonical.customerName)
  ) {
    errors.push({
      field: "customerName",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.CUSTOMER_NAME_INVALID,
      message:
        "中文姓名须为 1～5 个中文字；英文姓名至少 4 个字母",
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

  const projectResolved = resolveRequestedProjectForPersist({
    requestedProjectCode: canonical.requestedProjectCode || null,
    requestedProjectName: canonical.requestedProjectName || null,
    mode: "create",
  });
  if (!projectResolved.ok) {
    const first = projectResolved.fieldErrors[0];
    const isRequired =
      first?.code === "REQUESTED_PROJECT_CODE_REQUIRED" ||
      first?.code === "REQUESTED_PROJECT_NAME_REQUIRED";
    errors.push({
      field: first?.field === "requestedProjectCode"
        ? "requestedProjectCode"
        : "requestedProjectName",
      errorCode: isRequired
        ? QUICK_ENTRY_CUSTOMER_ERROR_CODES.PROJECT_REQUIRED
        : QUICK_ENTRY_CUSTOMER_ERROR_CODES.PROJECT_INVALID,
      message: first?.message ?? "需求业务无效",
    });
  } else if (
    projectResolved.value.requestedProjectName &&
    projectResolved.value.requestedProjectName.length >
      QUICK_ENTRY_PROJECT_MAX_LENGTH
  ) {
    errors.push({
      field: "requestedProjectName",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.PROJECT_INVALID,
      message: "项目名称过长",
    });
  } else if (
    projectResolved.value.requestedProjectCode === "other" &&
    projectResolved.value.requestedProjectName &&
    !hasSubstantiveContent(projectResolved.value.requestedProjectName, 4)
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

  if (!canonical.source) {
    errors.push({
      field: "source",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.SOURCE_REQUIRED,
      message: "请选择客户来源",
    });
  } else if (options?.selectableSourceKeys) {
    const sourceError = validateQuickEntryCustomerSourceKey(
      canonical.source,
      options.selectableSourceKeys,
    );
    if (sourceError) {
      errors.push(sourceError);
    }
  }

  if (
    canonical.source === CUSTOMER_SOURCE_OTHER_KEY &&
    !canonical.supplementalNote
  ) {
    errors.push({
      field: "supplementalNote",
      errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.SOURCE_REMARK_REQUIRED,
      message: "来源为「其他」时，备注必填",
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  if (!projectResolved.ok || !projectResolved.value.requestedProjectCode) {
    return {
      ok: false,
      errors: [
        {
          field: "requestedProjectCode",
          errorCode: QUICK_ENTRY_CUSTOMER_ERROR_CODES.PROJECT_REQUIRED,
          message: "需求业务必填",
        },
      ],
    };
  }

  return {
    ok: true,
    value: canonicalToNormalizedCustomer({
      customerName: canonical.customerName,
      nameStatus: canonical.nameStatus,
      phone: canonical.phone,
      phoneCountryCode: QUICK_ENTRY_FIXED_PHONE_COUNTRY_CODE,
      wechatId: canonical.wechatId,
      email: canonical.email,
      requestedProjectCode: projectResolved.value.requestedProjectCode,
      requestedProjectName: projectResolved.value.requestedProjectName ?? "",
      source: canonical.source,
      initialFollowUpNote: canonical.initialFollowUpNote,
      supplementalNote: canonical.supplementalNote,
    }),
  };
}
