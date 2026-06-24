import { getDb, schema } from "@/lib/db";
import type { Customer } from "../../../drizzle/schema/customers";

/** DB column names tracked in field_change_logs. */
const TRACKED_FIELDS = [
  { key: "customerName" as const, fieldName: "customer_name" },
  { key: "customerType" as const, fieldName: "customer_type" },
  { key: "phone" as const, fieldName: "phone" },
  { key: "wechatId" as const, fieldName: "wechat_id" },
  { key: "email" as const, fieldName: "email" },
  { key: "source" as const, fieldName: "source" },
  { key: "sourceRemark" as const, fieldName: "source_remark" },
  { key: "salesStage" as const, fieldName: "sales_stage" },
  { key: "status" as const, fieldName: "status" },
  { key: "notes" as const, fieldName: "notes" },
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
    notes: string | null;
    salesStage: string;
    status: string;
  },
): CustomerUpdatePayload {
  return {
    customerName: input.customerName.trim(),
    customerType: input.customerType,
    phoneCountryCode: input.phoneCountryCode,
    phone: normalizeValue(input.phone),
    wechatId: normalizeValue(input.wechatId),
    email: input.email?.trim().toLowerCase() || null,
    source: input.source,
    sourceRemark: normalizeValue(input.sourceRemark),
    notes: normalizeValue(input.notes),
    salesStage: input.salesStage,
    status: input.status as Customer["status"],
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
