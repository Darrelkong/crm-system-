import {
  CUSTOMER_SOURCE_KEYS,
  CUSTOMER_SOURCE_OTHER_KEY,
} from "@/lib/constants/customer-sources";
import { isCustomerType, isSalesStage } from "@/lib/constants/customer-fields";
import {
  CUSTOMER_STATUSES,
} from "../../../drizzle/schema/customers";

const CN_PHONE_RE = /^1\d{10}$/;
const CHINESE_CHAR_RE = /[\u4e00-\u9fff]/g;
const LATIN_LETTER_RE = /[A-Za-z]/g;

export function countChineseCharacters(value: string): number {
  return value.match(CHINESE_CHAR_RE)?.length ?? 0;
}

export function countLatinLetters(value: string): number {
  return value.match(LATIN_LETTER_RE)?.length ?? 0;
}

function hasSubstantiveContent(value: string, minLength: number): boolean {
  const trimmed = value.trim();
  if (trimmed.length < minLength) return false;
  const substantive = trimmed.replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, "");
  return substantive.length >= minLength;
}

export function isValidCustomerName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const chineseCount = countChineseCharacters(trimmed);
  if (chineseCount >= 2) return true;
  return countLatinLetters(trimmed) >= 4;
}

export type CustomerInput = {
  customerName?: string;
  customerType?: string;
  phoneCountryCode?: string;
  phone?: string | null;
  wechatId?: string | null;
  email?: string | null;
  source?: string;
  sourceRemark?: string | null;
  requestedProjectName?: string | null;
  notes?: string | null;
  salesStage?: string;
  status?: string;
};

export type ValidationFieldError = { field: string; message: string; code: string };

export type CustomerValidationContext = {
  isUpdate?: boolean;
  existingNotes?: string | null;
  /** Active customer tag keys from customer_tags (falls back to constants). */
  allowedSourceKeys?: readonly string[];
  /** Require salesStage on create (not on update). */
  requireSalesStage?: boolean;
};

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
      message: "请填写客户当前阶段备注，至少 10 个字",
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
  if (!customerName) {
    errors.push({
      field: "customerName",
      message: "客户名称必填",
      code: "CUSTOMER_NAME_REQUIRED",
    });
  } else if (!isValidCustomerName(customerName)) {
    errors.push({
      field: "customerName",
      message:
        "请输入有效的客户姓名。中文姓名至少 2 个汉字；英文姓名至少 4 个英文字母",
      code: "INVALID_CUSTOMER_NAME",
    });
  }

  const requestedProjectName = input.requestedProjectName?.trim() ?? "";
  if (!requestedProjectName) {
    errors.push({
      field: "requestedProjectName",
      message: "客户需要的项目名称必填",
      code: "REQUESTED_PROJECT_NAME_REQUIRED",
    });
  } else if (!hasSubstantiveContent(requestedProjectName, 4)) {
    errors.push({
      field: "requestedProjectName",
      message: "项目名称至少 4 个字，且不能只填符号",
      code: "INVALID_REQUESTED_PROJECT_NAME",
    });
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

  if (
    !input.source ||
    !(context?.allowedSourceKeys ?? CUSTOMER_SOURCE_KEYS).includes(input.source)
  ) {
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

  return errors;
}

/** @deprecated use validateCustomerInput */
export const validateCreateCustomer = validateCustomerInput;
export type CreateCustomerInput = CustomerInput;
