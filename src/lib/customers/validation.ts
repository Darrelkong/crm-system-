import {
  CUSTOMER_SOURCE_OTHER_KEY,
} from "@/lib/constants/customer-sources";
import { assertWritableCustomerSourceKey } from "@/lib/customer-sources/keys";
import {
  isCustomerType,
  isApprovalOnlySalesStage,
  isDirectCreateBlockedSalesStage,
  isSalesStage,
} from "@/lib/constants/customer-fields";
import {
  CUSTOMER_STATUSES,
} from "../../../drizzle/schema/customers";
import {
  isCustomerNameStatus,
  isPendingNamePlaceholder,
  type CustomerNameStatus,
} from "@/lib/customers/name-status";
import { resolveRequestedProjectForPersist } from "@/lib/customers/requested-project-resolve";
import {
  normalizeCustomerProfileFields,
  validateCustomerProfileFields,
} from "@/lib/customers/customer-profile";

const CN_PHONE_RE = /^1\d{10}$/;
const CHINESE_CHAR_RE = /[\u4e00-\u9fff]/g;
const LATIN_LETTER_RE = /[A-Za-z]/g;
/** Pure CJK unified ideographs, length 1–5 (confirmed real names). */
const PURE_CHINESE_NAME_RE = /^[\u4e00-\u9fff]{1,5}$/;
/**
 * English confirmed names: letters with optional single spaces, hyphens, or
 * apostrophes between letter groups (e.g. John Smith, Mary-Jane, O'Connor).
 */
const ENGLISH_NAME_RE = /^[A-Za-z]+(?:[ '\-][A-Za-z]+)*$/;

export function countChineseCharacters(value: string): number {
  return value.match(CHINESE_CHAR_RE)?.length ?? 0;
}

export function countLatinLetters(value: string): number {
  return value.match(LATIN_LETTER_RE)?.length ?? 0;
}

export function hasSubstantiveContent(
  value: string,
  minLength: number,
): boolean {
  const trimmed = value.trim();
  if (trimmed.length < minLength) return false;
  const substantive = trimmed.replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, "");
  return substantive.length >= minLength;
}

export function isValidCustomerName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (PURE_CHINESE_NAME_RE.test(trimmed)) return true;
  // Any remaining Chinese → wrong length, mixed script, or punctuation.
  if (countChineseCharacters(trimmed) > 0) return false;
  if (/\d/.test(trimmed)) return false;
  if (!ENGLISH_NAME_RE.test(trimmed)) return false;
  return countLatinLetters(trimmed) >= 4;
}

export type CustomerInput = {
  customerName?: string;
  /** Create-only; omit / confirmed = real name. Pending requires exact placeholder. */
  nameStatus?: CustomerNameStatus;
  customerType?: string;
  phoneCountryCode?: string;
  phone?: string | null;
  wechatId?: string | null;
  email?: string | null;
  source?: string;
  sourceRemark?: string | null;
  requestedProjectCode?: string | null;
  requestedProjectName?: string | null;
  notes?: string | null;
  salesStage?: string;
  status?: string;
  preferredName?: string | null;
  gender?: string | null;
  ageRange?: string | null;
  preferredLanguage?: string | null;
  preferredContactMethod?: string | null;
  occupation?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  targetCountryOrRegion?: string | null;
  primaryConcern?: string | null;
};

export type ValidationFieldError = { field: string; message: string; code: string };

export type CustomerValidationContext = {
  isUpdate?: boolean;
  existingNotes?: string | null;
  existingSalesStage?: string | null;
  /** Active customer tag keys from customer_tags (falls back to constants). */
  allowedSourceKeys?: readonly string[];
  /** When updating, the customer's current persisted source key. */
  existingSourceKey?: string | null;
  /** Require salesStage on create (not on update). */
  requireSalesStage?: boolean;
  /** Apply create-time nameStatus / placeholder rules (POST create only). */
  enforceCreateNameStatusRules?: boolean;
  userRole?: "admin" | "staff";
  /** Import and other flows that block closed_won / closed_lost for all roles. */
  disallowDirectTerminalSalesStages?: boolean;
  existingRequestedProjectCode?: string | null;
  existingRequestedProjectName?: string | null;
};

const DIRECT_TERMINAL_SALES_STAGE_MESSAGE =
  "不能直接设置为已成交、已流失或已付款，请使用审批流程";

function validateDirectTerminalSalesStage(
  salesStage: string | undefined,
  context?: CustomerValidationContext,
): ValidationFieldError | null {
  const stage = salesStage?.trim();
  if (!stage) {
    return null;
  }

  if (isApprovalOnlySalesStage(stage)) {
    if (!context?.isUpdate) {
      return {
        field: "salesStage",
        message: DIRECT_TERMINAL_SALES_STAGE_MESSAGE,
        code: "SALES_STAGE_DIRECT_TERMINAL_BLOCKED",
      };
    }

    const existing = context.existingSalesStage?.trim() ?? "";
    if (stage === existing) {
      return null;
    }

    return {
      field: "salesStage",
      message: DIRECT_TERMINAL_SALES_STAGE_MESSAGE,
      code: "SALES_STAGE_DIRECT_TERMINAL_BLOCKED",
    };
  }

  if (!isDirectCreateBlockedSalesStage(stage)) {
    return null;
  }

  if (context?.disallowDirectTerminalSalesStages) {
    return {
      field: "salesStage",
      message: DIRECT_TERMINAL_SALES_STAGE_MESSAGE,
      code: "SALES_STAGE_DIRECT_TERMINAL_BLOCKED",
    };
  }

  if (!context?.isUpdate) {
    return {
      field: "salesStage",
      message: DIRECT_TERMINAL_SALES_STAGE_MESSAGE,
      code: "SALES_STAGE_DIRECT_TERMINAL_BLOCKED",
    };
  }

  if (context.userRole !== "staff") {
    return null;
  }

  const existing = context.existingSalesStage?.trim() ?? "";
  if (stage === existing) {
    return null;
  }

  return {
    field: "salesStage",
    message: DIRECT_TERMINAL_SALES_STAGE_MESSAGE,
    code: "SALES_STAGE_DIRECT_TERMINAL_BLOCKED",
  };
}

function validateStageNotes(
  notes: string | null | undefined,
  context?: CustomerValidationContext,
): ValidationFieldError | null {
  const trimmed = notes?.trim() ?? "";
  const existingTrimmed = context?.existingNotes?.trim() ?? "";

  if (
    context?.isUpdate &&
    existingTrimmed &&
    trimmed === existingTrimmed &&
    !hasSubstantiveContent(existingTrimmed, 10)
  ) {
    return null;
  }

  if (!hasSubstantiveContent(trimmed, 10)) {
    return {
      field: "notes",
      message: "请填写客户首次沟通备注，至少 10 个字",
      code: "STAGE_NOTES_REQUIRED",
    };
  }

  return null;
}

/** Shared validation for create and update. */
export function validateCustomerInput(
  input: CustomerInput,
  context?: CustomerValidationContext,
): ValidationFieldError[] {
  const errors: ValidationFieldError[] = [];

  const customerName = input.customerName?.trim() ?? "";
  const nameStatus: CustomerNameStatus =
    input.nameStatus === "pending" ? "pending" : "confirmed";

  if (context?.enforceCreateNameStatusRules) {
    if (input.nameStatus !== undefined && !isCustomerNameStatus(input.nameStatus)) {
      errors.push({
        field: "nameStatus",
        message: "姓名状态无效",
        code: "INVALID_NAME_STATUS",
      });
    }

    if (nameStatus === "pending") {
      if (!customerName) {
        errors.push({
          field: "customerName",
          message: "请选择 X先生 或 X女士",
          code: "PENDING_NAME_REQUIRED",
        });
      } else if (!isPendingNamePlaceholder(customerName)) {
        errors.push({
          field: "customerName",
          message: "待确认姓名只能选择 X先生 或 X女士",
          code: "INVALID_PENDING_NAME_PLACEHOLDER",
        });
      }
    } else if (!customerName) {
      errors.push({
        field: "customerName",
        message: "客户名称必填",
        code: "CUSTOMER_NAME_REQUIRED",
      });
    } else if (isPendingNamePlaceholder(customerName)) {
      errors.push({
        field: "customerName",
        message: "请改用「暂时不知道客户真实姓名」建立待确认姓名",
        code: "CONFIRMED_PLACEHOLDER_FORBIDDEN",
      });
    } else if (!isValidCustomerName(customerName)) {
      errors.push({
        field: "customerName",
        message:
          "请输入有效的客户姓名。中文姓名须为 1～5 个汉字；英文姓名至少 4 个英文字母",
        code: "INVALID_CUSTOMER_NAME",
      });
    }
  } else if (!customerName) {
    errors.push({
      field: "customerName",
      message: "客户名称必填",
      code: "CUSTOMER_NAME_REQUIRED",
    });
  } else if (!isValidCustomerName(customerName)) {
    errors.push({
      field: "customerName",
      message:
        "请输入有效的客户姓名。中文姓名须为 1～5 个汉字；英文姓名至少 4 个英文字母",
      code: "INVALID_CUSTOMER_NAME",
    });
  }

  const projectResult = resolveRequestedProjectForPersist({
    requestedProjectCode: input.requestedProjectCode,
    requestedProjectName: input.requestedProjectName,
    mode: context?.isUpdate ? "update" : "create",
    existingCode: context?.existingRequestedProjectCode ?? null,
    existingName: context?.existingRequestedProjectName ?? null,
  });
  if (!projectResult.ok) {
    errors.push(...projectResult.fieldErrors);
  }

  const phone = input.phone?.trim() ?? "";
  const wechatId = input.wechatId?.trim() ?? "";

  if (!phone && !wechatId) {
    errors.push({
      field: "phone",
      message: "请至少填写手机号或微信号",
      code: "PHONE_OR_WECHAT_REQUIRED",
    });
  }

  if (phone) {
    const cc = input.phoneCountryCode?.trim() || "+86";
    if (cc === "+86" && !CN_PHONE_RE.test(phone)) {
      errors.push({
        field: "phone",
        message: "+86 手机号必须为 11 位数字，且以 1 开头",
        code: "INVALID_PHONE_CN",
      });
    }
  }

  const email = input.email?.trim() ?? "";
  if (email && !email.includes("@")) {
    errors.push({
      field: "email",
      message: "Email 格式不正确，必须包含 @",
      code: "INVALID_EMAIL",
    });
  }

  const sourceUnchanged =
    context?.isUpdate &&
    context.existingSourceKey != null &&
    input.source === context.existingSourceKey;

  const allowedKeys = context?.allowedSourceKeys ?? [];
  const sourceAllowed =
    sourceUnchanged ||
    (input.source &&
      allowedKeys.length > 0 &&
      assertWritableCustomerSourceKey(input.source, allowedKeys));

  if (!input.source || !sourceAllowed) {
    errors.push({
      field: "source",
      message: "请从固定字典选择客户来源",
      code: "SOURCE_REQUIRED",
    });
  }

  if (
    input.source === CUSTOMER_SOURCE_OTHER_KEY &&
    !input.sourceRemark?.trim()
  ) {
    errors.push({
      field: "sourceRemark",
      message: "来源为「其他」时，备注必填",
      code: "SOURCE_REMARK_REQUIRED",
    });
  }

  const stageNotesError = validateStageNotes(input.notes, context);
  if (stageNotesError) {
    errors.push(stageNotesError);
  }

  if (input.customerType && !isCustomerType(input.customerType)) {
    errors.push({
      field: "customerType",
      message: "客户类型无效",
      code: "INVALID_CUSTOMER_TYPE",
    });
  }

  if (context?.requireSalesStage && !input.salesStage?.trim()) {
    errors.push({
      field: "salesStage",
      message: "请选择销售阶段",
      code: "SALES_STAGE_REQUIRED",
    });
  }

  if (input.salesStage?.trim() && !isSalesStage(input.salesStage)) {
    errors.push({
      field: "salesStage",
      message: "销售阶段无效",
      code: "INVALID_SALES_STAGE",
    });
  }

  const directTerminalError = validateDirectTerminalSalesStage(
    input.salesStage,
    context,
  );
  if (directTerminalError) {
    errors.push(directTerminalError);
  }

  if (
    input.status &&
    !(CUSTOMER_STATUSES as readonly string[]).includes(input.status)
  ) {
    errors.push({
      field: "status",
      message: "客户状态无效",
      code: "INVALID_STATUS",
    });
  }

  const profile = normalizeCustomerProfileFields(input);
  errors.push(...validateCustomerProfileFields(profile));

  return errors;
}

/** @deprecated use validateCustomerInput */
export const validateCreateCustomer = validateCustomerInput;
export type CreateCustomerInput = CustomerInput;
