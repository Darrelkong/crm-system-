import type { ImportIssue } from "@/lib/import/customers/types";

type TranslateFn = (
  key: string,
  params?: Record<string, string>,
) => string;

const ISSUE_CODE_TO_KEY: Record<string, string> = {
  csv_parse_error: "importErrorTypes.csvParseError",
  empty_row: "importErrorTypes.emptyRow",
  empty_csv: "importErrorTypes.emptyCsv",
  unknown_columns: "importErrorTypes.unknownColumns",
  invalid_control_char: "importErrorTypes.invalidControlChar",
  default_customer_type: "importErrorTypes.defaultCustomerType",
  default_sales_stage: "importErrorTypes.defaultSalesStage",
  default_phone_country_code: "importErrorTypes.defaultPhoneCountryCode",
  missing_customer_name: "importErrorTypes.missingCustomerName",
  missing_contact: "importErrorTypes.missingContact",
  invalid_email: "importErrorTypes.invalidEmail",
  invalid_source: "importErrorTypes.invalidSource",
  missing_source_remark: "importErrorTypes.missingSourceRemark",
  invalid_customer_type: "importErrorTypes.invalidCustomerType",
  invalid_sales_stage: "importErrorTypes.invalidSalesStage",
  duplicate_phone_csv: "importErrorTypes.duplicatePhoneCsv",
  duplicate_wechatId_csv: "importErrorTypes.duplicateWechatCsv",
  duplicate_email_csv: "importErrorTypes.duplicateEmailCsv",
  duplicate_phone_db: "importErrorTypes.duplicatePhoneDb",
  duplicate_wechatId_db: "importErrorTypes.duplicateWechatDb",
  duplicate_email_db: "importErrorTypes.duplicateEmailDb",
  job_not_found: "importErrorTypes.jobNotFound",
  job_not_owned: "importErrorTypes.jobNotOwned",
  job_already_completed: "importErrorTypes.jobAlreadyCompleted",
  job_already_failed: "importErrorTypes.jobAlreadyFailed",
  job_invalid_status: "importErrorTypes.jobInvalidStatus",
  job_has_errors: "importErrorTypes.jobHasErrors",
  precheck_has_errors: "importErrorTypes.precheckHasErrors",
  precheck_mismatch: "importErrorTypes.precheckMismatch",
};

export function resolveImportIssue(
  t: TranslateFn,
  issue: ImportIssue,
): string {
  const key = ISSUE_CODE_TO_KEY[issue.code];
  if (key) {
    const translated = t(key, {
      value: issue.value ?? "",
      field: issue.field,
      row: String(issue.rowNumber),
    });
    if (translated !== key) return translated;
  }
  return issue.message;
}
