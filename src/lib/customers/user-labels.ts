import { eq, inArray } from "drizzle-orm";
import {
  listCustomerAssignees,
  sortCustomerAssigneeRecords,
  type CustomerAssigneeRecord,
} from "@/lib/customers/assignees";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";

export type CustomerDetailDisplayNames = {
  ownerName: string | null;
  createdByName: string | null;
  assigneeNames: string[];
  primaryOwner: { id: string; displayName: string } | null;
  collaborators: Array<{ id: string; displayName: string }>;
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

  const collaborators = assignees
    .filter((assignee) => assignee.role === "collaborator")
    .map((assignee) => ({
      id: assignee.userId,
      displayName: nameMap.get(assignee.userId) ?? assignee.userId,
    }));

  return {
    ownerName: customer.ownerId
      ? (nameMap.get(customer.ownerId) ?? null)
      : null,
    createdByName: customer.createdBy
      ? (nameMap.get(customer.createdBy) ?? null)
      : null,
    assigneeNames: formatAssigneeDisplayNames(assignees, nameMap),
    primaryOwner:
      customer.ownerId && nameMap.has(customer.ownerId)
        ? {
            id: customer.ownerId,
            displayName: nameMap.get(customer.ownerId)!,
          }
        : null,
    collaborators,
  };
}

/**
 * Admin Customer Detail display names in one effective D1 network wait:
 * assignees+names and owner/creator lookups run in parallel.
 */
export async function resolveAdminCustomerDetailDisplayNames(
  db: Database,
  customerId: string,
  customer: { ownerId: string | null; createdBy: string | null },
): Promise<CustomerDetailDisplayNames> {
  const [assigneeRows, ownerCreatorRows] = await Promise.all([
    db
      .select({
        assignee: schema.customerAssignees,
        displayName: schema.users.displayName,
      })
      .from(schema.customerAssignees)
      .leftJoin(
        schema.users,
        eq(schema.customerAssignees.userId, schema.users.id),
      )
      .where(eq(schema.customerAssignees.customerId, customerId)),
    (async () => {
      const ids = [customer.ownerId, customer.createdBy].filter(
        (id): id is string => !!id,
      );
      if (ids.length === 0) {
        return [] as Array<{ id: string; displayName: string }>;
      }
      return db
        .select({
          id: schema.users.id,
          displayName: schema.users.displayName,
        })
        .from(schema.users)
        .where(inArray(schema.users.id, ids));
    })(),
  ]);

  const assignees = sortCustomerAssigneeRecords(
    assigneeRows.map((row) => ({
      id: row.assignee.id,
      customerId: row.assignee.customerId,
      userId: row.assignee.userId,
      role: row.assignee.role,
      assignedBy: row.assignee.assignedBy ?? null,
      assignedAt: row.assignee.assignedAt,
      createdAt: row.assignee.createdAt,
      updatedAt: row.assignee.updatedAt,
    })),
  );

  const nameMap = new Map<string, string>();
  for (const row of assigneeRows) {
    if (row.displayName) {
      nameMap.set(row.assignee.userId, row.displayName);
    }
  }
  for (const row of ownerCreatorRows) {
    nameMap.set(row.id, row.displayName);
  }

  const collaborators = assignees
    .filter((assignee) => assignee.role === "collaborator")
    .map((assignee) => ({
      id: assignee.userId,
      displayName: nameMap.get(assignee.userId) ?? assignee.userId,
    }));

  return {
    ownerName: customer.ownerId
      ? (nameMap.get(customer.ownerId) ?? null)
      : null,
    createdByName: customer.createdBy
      ? (nameMap.get(customer.createdBy) ?? null)
      : null,
    assigneeNames: formatAssigneeDisplayNames(assignees, nameMap),
    primaryOwner:
      customer.ownerId && nameMap.has(customer.ownerId)
        ? {
            id: customer.ownerId,
            displayName: nameMap.get(customer.ownerId)!,
          }
        : null,
    collaborators,
  };
}

export async function resolveCustomerAssigneeNames(
  db: Database,
  customerId: string,
): Promise<string[]> {
  const assignees = await listCustomerAssignees(db, customerId);
  return resolveCustomerAssigneeNamesFromRecords(db, assignees);
}
