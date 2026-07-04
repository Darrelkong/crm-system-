import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";

/**
 * Returns the set of customer IDs — drawn from the given candidates — that
 * have at least one active collaborator row (role = "collaborator") in
 * customer_assignees.
 *
 * Collaborative customers are exempt from ordinary auto-reclaim and
 * pre-reclaim warnings (C-2).  The dedicated collaborative-dissolution
 * logic (90-day inactivity → 7-day grace → public pool) is introduced
 * in PHASE-C-3 (dry-run) and will execute in C-4/C-5.
 */
export async function getCollaborativeCustomerIds(
  db: Database,
  customerIds: string[],
): Promise<Set<string>> {
  if (customerIds.length === 0) {
    return new Set();
  }

  const rows = await db
    .select({ customerId: schema.customerAssignees.customerId })
    .from(schema.customerAssignees)
    .where(
      and(
        inArray(schema.customerAssignees.customerId, customerIds),
        eq(schema.customerAssignees.role, "collaborator"),
      ),
    );

  return new Set(rows.map((row) => row.customerId));
}

/**
 * Returns collaborator counts per customer ID (role = "collaborator" only).
 */
export async function getCollaboratorCountsByCustomerId(
  db: Database,
  customerIds: string[],
): Promise<Map<string, number>> {
  if (customerIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({ customerId: schema.customerAssignees.customerId })
    .from(schema.customerAssignees)
    .where(
      and(
        inArray(schema.customerAssignees.customerId, customerIds),
        eq(schema.customerAssignees.role, "collaborator"),
      ),
    );

  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.customerId, (counts.get(row.customerId) ?? 0) + 1);
  }
  return counts;
}
