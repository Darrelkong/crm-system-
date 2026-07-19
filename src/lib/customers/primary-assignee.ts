import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";

export type BuildPrimaryAssigneeInput = {
  customerId: string;
  /** The owner user; primary assignee must always mirror the customer owner. */
  ownerId: string;
  /** The user performing the create action. */
  assignedBy: string;
  /** Must be the same timestamp used for the customer row. */
  now: string;
};

/**
 * Builds the insert statement for a customer's primary assignee row.
 *
 * Callers MUST include the returned statement in the same `db.batch` as the
 * customer insert so that `customers.ownerId` and the `primary`
 * `customer_assignees` row are written atomically (owner ⇔ primary invariant).
 */
export function buildInsertPrimaryAssigneeStatement(
  db: Database,
  input: BuildPrimaryAssigneeInput,
) {
  return db.insert(schema.customerAssignees).values({
    id: crypto.randomUUID(),
    customerId: input.customerId,
    userId: input.ownerId,
    role: "primary",
    assignedBy: input.assignedBy,
    assignedAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
  });
}
