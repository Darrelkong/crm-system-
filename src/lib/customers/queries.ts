import { and, asc, eq, isNull, like, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { User } from "../../../drizzle/schema/users";

const followUpSort = [
  sql`CASE WHEN ${schema.customers.lastValidFollowUpAt} IS NULL THEN 0 ELSE 1 END`,
  asc(schema.customers.lastValidFollowUpAt),
  asc(schema.customers.createdAt),
];

export type CustomerListFilter = {
  /** Admin only: `archived` shows archived customers; default excludes archived. */
  status?: "archived";
};

type PermissionScope = "list" | "search";

function buildPermissionWhere(
  user: User,
  filter: CustomerListFilter = {},
  scope: PermissionScope = "list",
): SQL | undefined {
  if (user.role === "admin") {
    if (filter.status === "archived") {
      return eq(schema.customers.status, "archived");
    }
    return ne(schema.customers.status, "archived");
  }

  if (scope === "search") {
    return and(
      ne(schema.customers.status, "archived"),
      eq(schema.customers.ownerId, user.id),
    );
  }

  return and(
    ne(schema.customers.status, "archived"),
    or(
      eq(schema.customers.ownerId, user.id),
      eq(schema.customers.status, "public_pool"),
      isNull(schema.customers.ownerId),
    ),
  );
}

function escapeLikePattern(term: string): string {
  return term.replace(/[%_\\]/g, "\\$&");
}

function buildSearchWhere(term: string): SQL {
  const pattern = `%${escapeLikePattern(term)}%`;
  return or(
    like(schema.customers.customerName, pattern),
    like(schema.customers.phone, pattern),
    like(schema.customers.wechatId, pattern),
    like(schema.customers.email, pattern),
    like(schema.customers.customerCode, pattern),
  )!;
}

export async function listCustomersForUser(
  user: User,
  filter: CustomerListFilter = {},
  limit = 100,
) {
  const db = getDb();
  const permissionWhere = buildPermissionWhere(user, filter);

  return db
    .select()
    .from(schema.customers)
    .where(permissionWhere)
    .orderBy(...followUpSort)
    .limit(limit);
}

export async function searchCustomersForUser(
  user: User,
  query: string,
  filter: CustomerListFilter = {},
  limit = 100,
) {
  const term = query.trim();
  if (!term) {
    return listCustomersForUser(user, filter, limit);
  }

  const db = getDb();
  const permissionWhere = buildPermissionWhere(user, filter, "search");
  const searchWhere = buildSearchWhere(term);
  const whereClause = permissionWhere
    ? and(permissionWhere, searchWhere)
    : searchWhere;

  return db
    .select()
    .from(schema.customers)
    .where(whereClause)
    .orderBy(...followUpSort)
    .limit(limit);
}

export async function getCustomerById(id: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, id))
    .limit(1);
  return rows[0] ?? null;
}
