import { inArray } from "drizzle-orm";
import {
  listCustomerAssignees,
  type CustomerAssigneeRecord,
} from "@/lib/customers/assignees";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";

export type CustomerDetailDisplayNames = {
  ownerName: string | null;
  createdByName: string | null;
  assigneeNames: string[];
};

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

export function formatAssigneeDisplayNames(
  assignees: CustomerAssigneeRecord[],
  nameMap: Map<string, string>,
): string[] {
  return assignees
    .map((assignee) => nameMap.get(assignee.userId))
    .filter((name): name is string => !!name?.trim());
}

export async function resolveCustomerAssigneeNamesFromRecords(
  db: Database,
  assignees: CustomerAssigneeRecord[],
): Promise<string[]> {
  const nameMap = await resolveUserDisplayNames(
    db,
    assignees.map((assignee) => assignee.userId),
  );
  return formatAssigneeDisplayNames(assignees, nameMap);
}

/**
 * One users lookup for owner, creator, and assignee display names on Customer Detail.
 */
export async function resolveCustomerDetailDisplayNames(
  db: Database,
  customer: { ownerId: string | null; createdBy: string | null },
  assignees: CustomerAssigneeRecord[],
): Promise<CustomerDetailDisplayNames> {
  const nameMap = await resolveUserDisplayNames(db, [
    customer.ownerId,
    customer.createdBy,
    ...assignees.map((assignee) => assignee.userId),
  ]);

  return {
    ownerName: customer.ownerId
      ? (nameMap.get(customer.ownerId) ?? null)
      : null,
    createdByName: customer.createdBy
      ? (nameMap.get(customer.createdBy) ?? null)
      : null,
    assigneeNames: formatAssigneeDisplayNames(assignees, nameMap),
  };
}

export async function resolveCustomerAssigneeNames(
  db: Database,
  customerId: string,
): Promise<string[]> {
  const assignees = await listCustomerAssignees(db, customerId);
  return resolveCustomerAssigneeNamesFromRecords(db, assignees);
}
