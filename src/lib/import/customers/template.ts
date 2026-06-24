import { IMPORT_TEMPLATE_HEADER } from "@/lib/import/customers/constants";

const EXAMPLE_ROW = [
  "示例客户",
  "individual",
  "+86",
  "13800138000",
  "",
  "example@email.com",
  "referral",
  "",
  "备注示例",
  "new_lead",
]
  .map((v) => (v.includes(",") ? `"${v}"` : v))
  .join(",");

export function buildCustomerImportTemplateCsv(): string {
  return `${IMPORT_TEMPLATE_HEADER}\n${EXAMPLE_ROW}\n`;
}
