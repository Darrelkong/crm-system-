import { CUSTOMER_SOURCE_KEYS } from "@/lib/constants/customer-sources";
import { CUSTOMER_TYPES, SALES_STAGES } from "@/lib/constants/customer-fields";

export const IMPORT_CSV_COLUMNS = [
  "customer_name",
  "customer_type",
  "phone_country_code",
  "phone",
  "wechat_id",
  "email",
  "source",
  "source_remark",
  "requested_project_name",
  "notes",
  "sales_stage",
] as const;

export type ImportCsvColumn = (typeof IMPORT_CSV_COLUMNS)[number];

export const IMPORT_TEMPLATE_HEADER = IMPORT_CSV_COLUMNS.join(",");

export const IMPORT_SOURCE_KEYS = CUSTOMER_SOURCE_KEYS;
export const IMPORT_CUSTOMER_TYPES = CUSTOMER_TYPES;
export const IMPORT_SALES_STAGES = SALES_STAGES;
