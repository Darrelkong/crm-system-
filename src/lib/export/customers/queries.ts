import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { ExportScope } from "@/lib/export/customers/constants";

export type CustomerExportRow = {
  id: string;
  customer_name: string;
  customer_type: string;
  phone_country_code: string;
  phone: string | null;
  wechat_id: string | null;
  email: string | null;
  source: string;
  source_remark: string | null;
  notes: string | null;
  sales_stage: string;
  status: string;
  owner_name: string | null;
  created_at: string;
  updated_at: string;
  last_follow_up_at: string | null;
  last_valid_follow_up_at: string | null;
  next_follow_up_at: string | null;
};

export async function listCustomersForExport(
  scope: ExportScope,
): Promise<CustomerExportRow[]> {
  const db = getDb();

  let statusFilter;
  switch (scope) {
    case "all_active":
      statusFilter = eq(schema.customers.status, "active");
      break;
    case "public_pool":
      statusFilter = eq(schema.customers.status, "public_pool");
      break;
    case "archived":
      statusFilter = eq(schema.customers.status, "archived");
      break;
    case "all":
      statusFilter = undefined;
      break;
  }

  const query = db
    .select({
      id: schema.customers.id,
      customer_name: schema.customers.customerName,
      customer_type: schema.customers.customerType,
      phone_country_code: schema.customers.phoneCountryCode,
      phone: schema.customers.phone,
      wechat_id: schema.customers.wechatId,
      email: schema.customers.email,
      source: schema.customers.source,
      source_remark: schema.customers.sourceRemark,
      notes: schema.customers.notes,
      sales_stage: schema.customers.salesStage,
      status: schema.customers.status,
      owner_name: schema.users.displayName,
      created_at: schema.customers.createdAt,
      updated_at: schema.customers.updatedAt,
      last_follow_up_at: schema.customers.lastFollowUpAt,
      last_valid_follow_up_at: schema.customers.lastValidFollowUpAt,
      next_follow_up_at: schema.customers.nextFollowUpAt,
    })
    .from(schema.customers)
    .leftJoin(schema.users, eq(schema.customers.ownerId, schema.users.id))
    .orderBy(asc(schema.customers.createdAt));

  if (statusFilter) {
    return query.where(statusFilter);
  }

  return query;
}
