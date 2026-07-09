import { and, eq, ne, or, sql, type SQL } from "drizzle-orm";
import { schema } from "@/lib/db";

export type CustomerListStatusFilter = {
  /** Admin only: `archived` shows archived customers; default excludes archived. */
  status?: "archived";
};

/** Exclude archived customers from normal list queries. */
export function excludeArchivedWhere(): SQL {
  return ne(schema.customers.status, "archived");
}

/**
 * Exclude public_pool customers from normal list queries.
 * Invariant: status = public_pool must never appear in GET /api/customers lists.
 */
export function excludePublicPoolWhere(): SQL {
  return ne(schema.customers.status, "public_pool");
}

/** Normal customer list: excludes archived and public_pool. */
export function normalCustomerListStatusWhere(): SQL {
  return and(excludeArchivedWhere(), excludePublicPoolWhere())!;
}

/** Admin list status scope: archived-only or normal (never includes public_pool). */
export function adminCustomerListStatusWhere(
  filter: CustomerListStatusFilter = {},
): SQL {
  if (filter.status === "archived") {
    return eq(schema.customers.status, "archived");
  }
  return normalCustomerListStatusWhere();
}

export function staffAssigneeExistsWhere(userId: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM customer_assignees ca
    WHERE ca.customer_id = ${schema.customers.id}
      AND ca.user_id = ${userId}
  )`;
}

/** Staff my-customers scope: owned or assignee, excluding archived and public_pool. */
export function staffCustomerListPermissionWhere(userId: string): SQL {
  return and(
    normalCustomerListStatusWhere(),
    or(
      eq(schema.customers.ownerId, userId),
      staffAssigneeExistsWhere(userId),
    ),
  )!;
}

/** Owned customers for reports/dashboards; excludes archived and public_pool. */
export function ownedNormalCustomerListWhere(userId: string): SQL {
  return and(
    eq(schema.customers.ownerId, userId),
    normalCustomerListStatusWhere(),
  )!;
}
