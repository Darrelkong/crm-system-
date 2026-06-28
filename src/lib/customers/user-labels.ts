import { inArray } from "drizzle-orm";
import { listCustomerAssignees } from "@/lib/customers/assignees";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";

export async function resolveUserDisplayNames(
  db: Database,
  userIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (ids.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, ids));

  return new Map(rows.map((row) => [row.id, row.displayName]));
}

export async function resolveCustomerUserLabels(
  db: Database,
  customer: { ownerId: string | null; createdBy: string | null },
): Promise<{ ownerName: string | null; createdByName: string | null }> {
  const nameMap = await resolveUserDisplayNames(db, [
    customer.ownerId,
    customer.createdBy,
  ]);

  return {
    ownerName: customer.ownerId ? (nameMap.get(customer.ownerId) ?? null) : null,
    createdByName: customer.createdBy
      ? (nameMap.get(customer.createdBy) ?? null)
      : null,
  };
}

export async function resolveCustomerAssigneeNames(
  db: Database,
  customerId: string,
): Promise<string[]> {
  const assignees = await listCustomerAssignees(db, customerId);
  const nameMap = await resolveUserDisplayNames(
    db,
    assignees.map((assignee) => assignee.userId),
  );

  return assignees
    .map((assignee) => nameMap.get(assignee.userId))
    .filter((name): name is string => !!name?.trim());
}
