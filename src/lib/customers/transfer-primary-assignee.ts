import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";

export type BuildTransferPrimaryAssigneeInput = {
  customerId: string;
  /** The new owner; primary assignee must mirror this user after transfer. */
  targetUserId: string;
  /** The reviewer approving the transfer. */
  assignedBy: string;
  /** Must be the same timestamp used for the customer owner update. */
  now: string;
};

/**
 * Builds statements that reassign a customer's `primary` assignee to
 * `targetUserId` while preserving every other collaborator.
 *
 * The returned statements MUST be included in the SAME `db.batch` as the
 * `customers` owner/status update so that `customers.ownerId` and the
 * `primary` `customer_assignees` row are written atomically.
 *
 * Statement order (batches execute sequentially):
 *   1. delete ALL existing `primary` rows (removes the old primary, and any
 *      accidental duplicate primaries).
 *   2. delete any existing row for the target user — regardless of role — so
 *      the fresh primary insert cannot violate unique(customer_id, user_id)
 *      when the target was previously a collaborator.
 *   3. insert exactly one `primary` row for the target user.
 *
 * Collaborators other than the target are never touched. This intentionally
 * does NOT reuse the public-pool `replaceCustomerPrimaryAssignee` helper, which
 * clears every assignee (and would wrongly drop collaborators).
 */
export function buildTransferPrimaryAssigneeStatements(
  db: Database,
  input: BuildTransferPrimaryAssigneeInput,
) {
  const deleteExistingPrimary = db
    .delete(schema.customerAssignees)
    .where(
      and(
        eq(schema.customerAssignees.customerId, input.customerId),
        eq(schema.customerAssignees.role, "primary"),
      ),
    );

  const deleteTargetRow = db
    .delete(schema.customerAssignees)
    .where(
      and(
        eq(schema.customerAssignees.customerId, input.customerId),
        eq(schema.customerAssignees.userId, input.targetUserId),
      ),
    );

  const insertTargetPrimary = db.insert(schema.customerAssignees).values({
    id: crypto.randomUUID(),
    customerId: input.customerId,
    userId: input.targetUserId,
    role: "primary",
    assignedBy: input.assignedBy,
    assignedAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
  });

  return [deleteExistingPrimary, deleteTargetRow, insertTargetPrimary];
}
