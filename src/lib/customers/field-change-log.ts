import { getDb, schema } from "@/lib/db";
import type { Customer } from "../../../drizzle/schema/customers";
import {
  normalizeCustomerProfileFields,
  type CustomerProfileFields,
} from "@/lib/customers/customer-profile";

/** DB column names tracked in field_change_logs. */
const TRACKED_FIELDS = [
  { key: "customerName" as const, fieldName: "customer_name" },
  { key: "customerType" as const, fieldName: "customer_type" },
  { key: "phone" as const, fieldName: "phone" },
  { key: "wechatId" as const, fieldName: "wechat_id" },
  { key: "email" as const, fieldName: "email" },
  { key: "source" as const, fieldName: "source" },
  { key: "sourceRemark" as const, fieldName: "source_remark" },
  { key: "requestedProjectCode" as const, fieldName: "requested_project_code" },
  { key: "requestedProjectName" as const, fieldName: "requested_project_name" },
  { key: "salesStage" as const, fieldName: "sales_stage" },
  { key: "status" as const, fieldName: "status" },
  { key: "notes" as const, fieldName: "notes" },
  { key: "preferredName" as const, fieldName: "preferred_name" },
  { key: "gender" as const, fieldName: "gender" },
  { key: "ageRange" as const, fieldName: "age_range" },
  { key: "preferredLanguage" as const, fieldName: "preferred_language" },
  {
    key: "preferredContactMethod" as const,
    fieldName: "preferred_contact_method",
  },
  { key: "occupation" as const, fieldName: "occupation" },
  { key: "companyName" as const, fieldName: "company_name" },
  { key: "jobTitle" as const, fieldName: "job_title" },
  {
    key: "targetCountryOrRegion" as const,
    fieldName: "target_country_or_region",
  },
  { key: "primaryConcern" as const, fieldName: "primary_concern" },
] as const;

type TrackedKey = (typeof TRACKED_FIELDS)[number]["key"];

export type CustomerUpdatePayload = Pick<Customer, TrackedKey> & {
  phoneCountryCode: string;
};

function normalizeValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function buildCustomerUpdatePayload(
  input: {
    customerName: string;
    customerType: string;
    phoneCountryCode: string;
    phone: string | null;
    wechatId: string | null;
    email: string | null;
    source: string;
    sourceRemark: string | null;
    requestedProjectCode?: string | null;
    requestedProjectName: string | null;
    notes: string | null;
    salesStage: string;
    status: string;
  } & Partial<CustomerProfileFields>,
): CustomerUpdatePayload {
  const profile = normalizeCustomerProfileFields(input);
  return {
    customerName: input.customerName.trim(),
    customerType: input.customerType,
    phoneCountryCode: input.phoneCountryCode,
    phone: normalizeValue(input.phone),
    wechatId: normalizeValue(input.wechatId),
    email: input.email?.trim().toLowerCase() || null,
    source: input.source,
    sourceRemark: normalizeValue(input.sourceRemark),
    requestedProjectCode: normalizeValue(input.requestedProjectCode),
    requestedProjectName: normalizeValue(input.requestedProjectName),
    notes: normalizeValue(input.notes),
    salesStage: input.salesStage,
    status: input.status as Customer["status"],
    preferredName: profile.preferredName,
    gender: profile.gender,
    ageRange: profile.ageRange,
    preferredLanguage: profile.preferredLanguage,
    preferredContactMethod: profile.preferredContactMethod,
    occupation: profile.occupation,
    companyName: profile.companyName,
    jobTitle: profile.jobTitle,
    targetCountryOrRegion: profile.targetCountryOrRegion,
    primaryConcern: profile.primaryConcern,
  };
}

export async function writeFieldChangeLogs(
  customerId: string,
  before: Customer,
  after: CustomerUpdatePayload,
  changedBy: string,
): Promise<string[]> {
  const db = getDb();
  const now = new Date().toISOString();
  const changedFields: string[] = [];

  for (const { key, fieldName } of TRACKED_FIELDS) {
    const oldRaw = before[key];
    const newRaw = after[key];
    const oldVal = normalizeValue(oldRaw);
    const newVal = normalizeValue(newRaw);

    if (oldVal === newVal) continue;

    changedFields.push(fieldName);
    await db.insert(schema.fieldChangeLogs).values({
      id: crypto.randomUUID(),
      customerId,
      fieldName,
      oldValue: oldVal,
      newValue: newVal,
      changedBy,
      changedAt: now,
    });
  }

  return changedFields;
}

export async function writeFieldChangeLogEntry(
  customerId: string,
  fieldName: string,
  oldValue: string | null,
  newValue: string | null,
  changedBy: string,
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  await db.insert(schema.fieldChangeLogs).values({
    id: crypto.randomUUID(),
    customerId,
    fieldName,
    oldValue,
    newValue,
    changedBy,
    changedAt: now,
  });
}
