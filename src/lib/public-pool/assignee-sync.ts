import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";

export async function countCustomerAssignees(
  db: Database,
  customerId: string,
): Promise<number> {
  const rows = await db
    .select({ id: schema.customerAssignees.id })
    .from(schema.customerAssignees)
    .where(eq(schema.customerAssignees.customerId, customerId));

  return rows.length;
}

/** Clears all assignees for a customer. Used by public pool release / claim / auto reclaim sync. */
export async function clearCustomerAssignees(
  db: Database,
  customerId: string,
): Promise<number> {
  const clearedAssigneeCount = await countCustomerAssignees(db, customerId);
  if (clearedAssigneeCount === 0) {
    return 0;
  }

  await db
    .delete(schema.customerAssignees)
    .where(eq(schema.customerAssignees.customerId, customerId));

  return clearedAssigneeCount;
}

export type ReplaceCustomerPrimaryAssigneeInput = {
  customerId: string;
  userId: string;
  assignedBy: string;
  now?: string;
};

/** Replaces all assignees with a single primary row. Used after successful pool claim. */
export async function replaceCustomerPrimaryAssignee(
  db: Database,
  input: ReplaceCustomerPrimaryAssigneeInput,
): Promise<{ clearedAssigneeCount: number }> {
  const now = input.now ?? new Date().toISOString();
  const clearedAssigneeCount = await countCustomerAssignees(db, input.customerId);

  const deleteStmt = db
    .delete(schema.customerAssignees)
    .where(eq(schema.customerAssignees.customerId, input.customerId));

  const insertStmt = db.insert(schema.customerAssignees).values({
    id: crypto.randomUUID(),
    customerId: input.customerId,
    userId: input.userId,
    role: "primary",
    assignedBy: input.assignedBy,
    assignedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await db.batch(
    [deleteStmt, insertStmt] as unknown as Parameters<Database["batch"]>[0],
  );

  return { clearedAssigneeCount };
}
