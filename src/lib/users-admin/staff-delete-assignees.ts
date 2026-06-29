import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";

export type StaffDeleteAssigneeSyncResult = {
  primaryAssigneesTransferredCount: number;
  collaboratorAssigneesRemovedCount: number;
};

/**
 * Builds batch statements to sync customer_assignees when a staff account is soft-deleted.
 * - Primary rows on transferred customers move to the acting admin (no duplicate user rows).
 * - All collaborator rows for the deleted user are removed.
 */
export async function appendStaffDeleteAssigneeStatements(
  db: Database,
  batchStatements: unknown[],
  input: {
    targetUserId: string;
    transferAdminId: string;
    transferredCustomerIds: string[];
    now: string;
  },
): Promise<StaffDeleteAssigneeSyncResult> {
  const { targetUserId, transferAdminId, transferredCustomerIds, now } = input;

  const deletedUserRows = await db
    .select({
      id: schema.customerAssignees.id,
      customerId: schema.customerAssignees.customerId,
      role: schema.customerAssignees.role,
    })
    .from(schema.customerAssignees)
    .where(eq(schema.customerAssignees.userId, targetUserId));

  const transferredIdSet = new Set(transferredCustomerIds);
  let primaryAssigneesTransferredCount = 0;
  let collaboratorAssigneesRemovedCount = 0;

  const primaryRowsToSync = deletedUserRows.filter(
    (row) => row.role === "primary" && transferredIdSet.has(row.customerId),
  );

  const adminRowsByCustomer = new Map<
    string,
    { id: string; role: string }
  >();

  if (primaryRowsToSync.length > 0) {
    const customerIds = [
      ...new Set(primaryRowsToSync.map((row) => row.customerId)),
    ];
    const adminRows = await db
      .select({
        id: schema.customerAssignees.id,
        customerId: schema.customerAssignees.customerId,
        role: schema.customerAssignees.role,
      })
      .from(schema.customerAssignees)
      .where(
        and(
          inArray(schema.customerAssignees.customerId, customerIds),
          eq(schema.customerAssignees.userId, transferAdminId),
        ),
      );

    for (const row of adminRows) {
      adminRowsByCustomer.set(row.customerId, { id: row.id, role: row.role });
    }
  }

  for (const primaryRow of primaryRowsToSync) {
    const adminRow = adminRowsByCustomer.get(primaryRow.customerId);

    if (adminRow) {
      batchStatements.push(
        db
          .delete(schema.customerAssignees)
          .where(eq(schema.customerAssignees.id, primaryRow.id)),
      );

      if (adminRow.role !== "primary") {
        batchStatements.push(
          db
            .update(schema.customerAssignees)
            .set({ role: "primary", updatedAt: now })
            .where(eq(schema.customerAssignees.id, adminRow.id)),
        );
      }
    } else {
      batchStatements.push(
        db
          .update(schema.customerAssignees)
          .set({ userId: transferAdminId, updatedAt: now })
          .where(eq(schema.customerAssignees.id, primaryRow.id)),
      );
    }

    primaryAssigneesTransferredCount += 1;
  }

  const collaboratorRows = deletedUserRows.filter(
    (row) => row.role === "collaborator",
  );

  if (collaboratorRows.length > 0) {
    batchStatements.push(
      db
        .delete(schema.customerAssignees)
        .where(
          and(
            eq(schema.customerAssignees.userId, targetUserId),
            eq(schema.customerAssignees.role, "collaborator"),
          ),
        ),
    );
    collaboratorAssigneesRemovedCount = collaboratorRows.length;
  }

  return {
    primaryAssigneesTransferredCount,
    collaboratorAssigneesRemovedCount,
  };
}
