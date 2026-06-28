import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import type { CustomerAssigneeRole } from "../../../drizzle/schema/customer-assignees";

export type CustomerAssigneeRecord = {
  id: string;
  customerId: string;
  userId: string;
  role: CustomerAssigneeRole;
  assignedBy: string | null;
  assignedAt: string;
  createdAt: string;
  updatedAt: string;
};

function toAssigneeRecord(
  row: typeof schema.customerAssignees.$inferSelect,
): CustomerAssigneeRecord {
  return {
    id: row.id,
    customerId: row.customerId,
    userId: row.userId,
    role: row.role,
    assignedBy: row.assignedBy ?? null,
    assignedAt: row.assignedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function sortAssignees(
  records: CustomerAssigneeRecord[],
): CustomerAssigneeRecord[] {
  return [...records].sort((a, b) => {
    const roleOrder =
      (a.role === "primary" ? 0 : 1) - (b.role === "primary" ? 0 : 1);
    if (roleOrder !== 0) {
      return roleOrder;
    }
    return a.assignedAt.localeCompare(b.assignedAt);
  });
}

export async function listCustomerAssignees(
  db: Database,
  customerId: string,
): Promise<CustomerAssigneeRecord[]> {
  const rows = await db
    .select()
    .from(schema.customerAssignees)
    .where(eq(schema.customerAssignees.customerId, customerId));

  return sortAssignees(rows.map(toAssigneeRecord));
}

export async function listCustomerAssigneesByCustomerIds(
  db: Database,
  customerIds: string[],
): Promise<Map<string, CustomerAssigneeRecord[]>> {
  const result = new Map<string, CustomerAssigneeRecord[]>();
  if (customerIds.length === 0) {
    return result;
  }

  const rows = await db
    .select()
    .from(schema.customerAssignees)
    .where(inArray(schema.customerAssignees.customerId, customerIds));

  for (const row of rows) {
    const record = toAssigneeRecord(row);
    const existing = result.get(record.customerId);
    if (existing) {
      existing.push(record);
    } else {
      result.set(record.customerId, [record]);
    }
  }

  for (const [customerId, records] of result) {
    result.set(customerId, sortAssignees(records));
  }

  return result;
}

export async function getCustomerAssigneeUserIds(
  db: Database,
  customerId: string,
): Promise<string[]> {
  const assignees = await listCustomerAssignees(db, customerId);
  return assignees.map((row) => row.userId);
}

export async function isCustomerAssignee(
  db: Database,
  customerId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.customerAssignees.id })
    .from(schema.customerAssignees)
    .where(
      and(
        eq(schema.customerAssignees.customerId, customerId),
        eq(schema.customerAssignees.userId, userId),
      ),
    )
    .limit(1);

  return rows.length > 0;
}
