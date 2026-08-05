import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import type { Customer } from "../../../drizzle/schema/customers";
import { RECLAMATION_EXCLUDED_SALES_STAGES } from "./constants";

/**
 * Snapshot fields used by every guarded Auto Reclaim statement in one batch.
 * Taken from the eligible-customer SELECT; never re-read mid-batch.
 */
export type AutoReclaimCustomerSnapshot = {
  id: string;
  ownerId: string;
  status: "active";
  updatedAt: string;
  lastValidFollowUpAt: string | null;
  reclamationCycleStartedAt: string | null;
  reclaimRuleGraceUntil: string | null;
  isPinned: number;
  salesStage: string;
  deletedAt: string | null;
  createdAt: string;
};

export function toAutoReclaimCustomerSnapshot(
  customer: Customer,
): AutoReclaimCustomerSnapshot | null {
  if (!customer.ownerId) return null;
  if (customer.status !== "active") return null;
  return {
    id: customer.id,
    ownerId: customer.ownerId,
    status: "active",
    updatedAt: customer.updatedAt,
    lastValidFollowUpAt: customer.lastValidFollowUpAt,
    reclamationCycleStartedAt: customer.reclamationCycleStartedAt,
    reclaimRuleGraceUntil: customer.reclaimRuleGraceUntil,
    isPinned: customer.isPinned,
    salesStage: customer.salesStage,
    deletedAt: customer.deletedAt,
    createdAt: customer.createdAt,
  };
}

/** Null-safe reclamation_cycle_started_at predicate on `customers`. */
export function buildReclamationCycleStartedAtMatchSql(
  reclamationCycleStartedAt: string | null,
) {
  if (reclamationCycleStartedAt == null) {
    return sql`customers.reclamation_cycle_started_at IS NULL`;
  }
  return sql`customers.reclamation_cycle_started_at = ${reclamationCycleStartedAt}`;
}

/** Null-safe last_valid_follow_up_at predicate on `customers`. */
export function buildLastValidFollowUpAtMatchSql(
  lastValidFollowUpAt: string | null,
) {
  if (lastValidFollowUpAt == null) {
    return sql`customers.last_valid_follow_up_at IS NULL`;
  }
  return sql`customers.last_valid_follow_up_at = ${lastValidFollowUpAt}`;
}

/**
 * Full snapshot match predicates on `customers`, including collaborative
 * exclusion (no collaborator rows for this customer).
 */
export function buildAutoReclaimSnapshotMatchSql(
  snapshot: AutoReclaimCustomerSnapshot,
) {
  return sql`
    customers.id = ${snapshot.id}
    AND customers.status = 'active'
    AND customers.owner_id = ${snapshot.ownerId}
    AND customers.updated_at = ${snapshot.updatedAt}
    AND customers.is_pinned = 0
    AND customers.deleted_at IS NULL
    AND customers.sales_stage NOT IN ('closed_won', 'converted', 'on_hold', 'paid')
    AND ${buildLastValidFollowUpAtMatchSql(snapshot.lastValidFollowUpAt)}
    AND ${buildReclamationCycleStartedAtMatchSql(snapshot.reclamationCycleStartedAt)}
    AND NOT EXISTS (
      SELECT 1
      FROM customer_assignees AS reclaim_collab
      WHERE reclaim_collab.customer_id = ${snapshot.id}
        AND reclaim_collab.role = 'collaborator'
    )
  `;
}

/** EXISTS (...) wrapper for side-effect statements in the same batch. */
export function buildAutoReclaimCustomerExistsGuardSql(
  snapshot: AutoReclaimCustomerSnapshot,
) {
  return sql`EXISTS (
    SELECT 1
    FROM customers
    WHERE ${buildAutoReclaimSnapshotMatchSql(snapshot)}
  )`;
}

/** Drizzle WHERE for the final Customer CAS UPDATE (same semantics as match SQL). */
export function buildAutoReclaimCustomerCasWhere(
  snapshot: AutoReclaimCustomerSnapshot,
) {
  return and(
    eq(schema.customers.id, snapshot.id),
    eq(schema.customers.status, "active"),
    eq(schema.customers.ownerId, snapshot.ownerId),
    eq(schema.customers.updatedAt, snapshot.updatedAt),
    eq(schema.customers.isPinned, 0),
    isNull(schema.customers.deletedAt),
    notInArray(schema.customers.salesStage, [
      ...RECLAMATION_EXCLUDED_SALES_STAGES,
    ]),
    snapshot.lastValidFollowUpAt == null
      ? isNull(schema.customers.lastValidFollowUpAt)
      : eq(schema.customers.lastValidFollowUpAt, snapshot.lastValidFollowUpAt),
    snapshot.reclamationCycleStartedAt == null
      ? isNull(schema.customers.reclamationCycleStartedAt)
      : eq(
          schema.customers.reclamationCycleStartedAt,
          snapshot.reclamationCycleStartedAt,
        ),
    sql`NOT EXISTS (
      SELECT 1
      FROM customer_assignees AS reclaim_collab
      WHERE reclaim_collab.customer_id = ${snapshot.id}
        AND reclaim_collab.role = 'collaborator'
    )`,
  );
}

export function buildGuardedDeleteCustomerAssigneesStatement(
  db: Database,
  snapshot: AutoReclaimCustomerSnapshot,
) {
  return db
    .delete(schema.customerAssignees)
    .where(
      and(
        eq(schema.customerAssignees.customerId, snapshot.id),
        buildAutoReclaimCustomerExistsGuardSql(snapshot),
      ),
    );
}

export function extractChanges(result: unknown): number | null {
  if (
    result &&
    typeof result === "object" &&
    "meta" in result &&
    result.meta &&
    typeof result.meta === "object" &&
    "changes" in result.meta &&
    typeof (result.meta as { changes: unknown }).changes === "number"
  ) {
    return (result.meta as { changes: number }).changes;
  }
  return null;
}

/** Auto Reclaim open task types cancelled for the previous owner only. */
export const AUTO_RECLAIM_CANCEL_TASK_TYPES = [
  "follow_up",
  "first_contact",
] as const;

export function buildSelectOwnerOpenReclaimTaskIds(
  db: Database,
  customerId: string,
  previousOwnerId: string,
) {
  return db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.customerId, customerId),
        eq(schema.tasks.assignedTo, previousOwnerId),
        eq(schema.tasks.status, "open"),
        inArray(schema.tasks.type, [...AUTO_RECLAIM_CANCEL_TASK_TYPES]),
      ),
    );
}
