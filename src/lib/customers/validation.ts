import {
  CUSTOMER_SOURCE_OTHER_KEY,
  isCustomerSourceKey,
} from "@/lib/constants/customer-sources";
import { isCustomerType, isSalesStage } from "@/lib/constants/customer-fields";

const CN_PHONE_RE = /^1\d{10}$/;

export type CreateCustomerInput = {
  customerName?: string;
  customerType?: string;
  phoneCountryCode?: string;
  phone?: string | null;
  wechatId?: string | null;
  email?: string | null;
  source?: string;
  sourceRemark?: string | null;
  notes?: string | null;
  salesStage?: string;
};

export type ValidationFieldError = { field: string; message: string };

export function validateCreateCustomer(
  input: CreateCustomerInput,
): ValidationFieldError[] {
  const errors: ValidationFieldError[] = [];

  if (!input.customerName?.trim()) {
    errors.push({ field: "customerName", message: "客户名称必填" });
  }

  const phone = input.phone?.trim() ?? "";
  const wechatId = input.wechatId?.trim() ?? "";

  if (!phone && !wechatId) {
    errors.push({ field: "phone", message: "手机号和微信号至少填写一个" });
  }

  if (phone) {
    const cc = input.phoneCountryCode?.trim() || "+86";
    if (cc === "+86" && !CN_PHONE_RE.test(phone)) {
      errors.push({
        field: "phone",
        message: "+86 手机号必须为 11 位数字，且以 1 开头",
      });
    }
  }

  const email = input.email?.trim() ?? "";
  if (email && !email.includes("@")) {
    errors.push({ field: "email", message: "Email 格式不正确，必须包含 @" });
  }

  if (!input.source || !isCustomerSourceKey(input.source)) {
    errors.push({ field: "source", message: "请从固定字典选择客户来源" });
  }

  if (
    input.source === CUSTOMER_SOURCE_OTHER_KEY &&
    !input.sourceRemark?.trim()
  ) {
    errors.push({
      field: "sourceRemark",
      message: "来源为「其他」时，备注必填",
    });
  }

  if (input.customerType && !isCustomerType(input.customerType)) {
    errors.push({ field: "customerType", message: "客户类型无效" });
  }

  if (input.salesStage && !isSalesStage(input.salesStage)) {
    errors.push({ field: "salesStage", message: "销售阶段无效" });
  }

  return errors;
}
