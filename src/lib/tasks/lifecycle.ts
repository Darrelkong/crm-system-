import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";

/** Server-only lifecycle reason codes for audit metadata (not timeline actions). */
export const TASK_CANCEL_REASON = {
  poolRelease: "pool_release",
  softArchive: "soft_archive",
  permanentDelete: "permanent_delete",
} as const;

export type TaskCancelReasonCode =
  (typeof TASK_CANCEL_REASON)[keyof typeof TASK_CANCEL_REASON];

/**
 * Single-statement cancel of all open tasks for a customer.
 * Does not filter by type or assignee. Idempotent when re-run.
 */
export function buildCancelOpenTasksForCustomerStatement(
  db: Database,
  customerId: string,
  now: string,
) {
  return db
    .update(schema.tasks)
    .set({
      status: "cancelled",
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.tasks.customerId, customerId),
        eq(schema.tasks.status, "open"),
      ),
    );
}

/**
 * Immediately cancel all open tasks for a customer (non-batch callers).
 * Prefer {@link buildCancelOpenTasksForCustomerStatement} inside db.batch.
 *
 * Does not return affected counts — D1 batch results are not relied on for
 * exact row counts, and a pre-UPDATE COUNT would not be atomic with the UPDATE.
 */
export async function cancelOpenTasksForCustomer(
  db: Database,
  customerId: string,
  now: string = new Date().toISOString(),
): Promise<void> {
  await buildCancelOpenTasksForCustomerStatement(db, customerId, now);
}

/**
 * Single-statement reassignment of all open tasks for one assignee.
 * Does not filter by type or customerId. Idempotent when re-run.
 * Server-only — never accept previous/next assignee from the client.
 */
export function buildReassignOpenTasksForAssigneeStatement(
  db: Database,
  input: {
    previousAssigneeId: string;
    nextAssigneeId: string;
    updatedAt: string;
  },
) {
  return db
    .update(schema.tasks)
    .set({
      assignedTo: input.nextAssigneeId,
      updatedAt: input.updatedAt,
    })
    .where(
      and(
        eq(schema.tasks.assignedTo, input.previousAssigneeId),
        eq(schema.tasks.status, "open"),
      ),
    );
}

/** Safe lifecycle audit fields only — no estimated/pre-count task totals. */
export function buildTaskCancelAuditFields(
  reasonCode: TaskCancelReasonCode,
): {
  taskCancelReasonCode: TaskCancelReasonCode;
} {
  return {
    taskCancelReasonCode: reasonCode,
  };
}
