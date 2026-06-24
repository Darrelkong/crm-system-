/** Default field values applied during CSV import when cells are empty. */
export const IMPORT_DEFAULTS = {
  customerType: "individual",
  phoneCountryCode: "+86",
  salesStage: "new_lead",
} as const;

export const IMPORT_DEFAULT_WARNINGS = {
  customerType: "customer_type 为空，已默认使用 individual",
  phoneCountryCode: "phone_country_code 为空，已默认使用 +86",
  salesStage: "sales_stage 为空，已默认使用 new_lead",
} as const;
