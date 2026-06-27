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
  /** Admin only: filter by `customers.created_by`. */
  createdBy?: string;
};

export type CustomerCreatorOption = {
  id: string;
  displayName: string;
  role: string;
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

function buildCreatedByWhere(
  user: User,
  filter: CustomerListFilter,
): SQL | undefined {
  if (user.role !== "admin" || !filter.createdBy) {
    return undefined;
  }
  return eq(schema.customers.createdBy, filter.createdBy);
}

function combineWhere(...clauses: Array<SQL | undefined>): SQL | undefined {
  const parts = clauses.filter((clause): clause is SQL => clause != null);
  if (parts.length === 0) {
    return undefined;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return and(...parts);
}

function buildListWhere(
  user: User,
  filter: CustomerListFilter = {},
  scope: PermissionScope = "list",
): SQL | undefined {
  return combineWhere(
    buildPermissionWhere(user, filter, scope),
    buildCreatedByWhere(user, filter),
  );
}

export async function listCustomerCreatorsForAdmin(
  filter: CustomerListFilter = {},
): Promise<CustomerCreatorOption[]> {
  const db = getDb();
  const statusWhere =
    filter.status === "archived"
      ? eq(schema.customers.status, "archived")
      : ne(schema.customers.status, "archived");

  const rows = await db
    .selectDistinct({
      id: schema.customers.createdBy,
      displayName: schema.users.displayName,
      role: schema.users.role,
    })
    .from(schema.customers)
    .innerJoin(schema.users, eq(schema.customers.createdBy, schema.users.id))
    .where(statusWhere)
    .orderBy(asc(schema.users.displayName));

  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    role: row.role,
  }));
}

export async function listCustomersForUser(
  user: User,
  filter: CustomerListFilter = {},
  limit = 100,
) {
  const db = getDb();
  const whereClause = buildListWhere(user, filter);

  return db
    .select()
    .from(schema.customers)
    .where(whereClause)
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
  const whereClause = combineWhere(
    buildListWhere(user, filter, "search"),
    buildSearchWhere(term),
  );

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

export function parseCustomerListFilter(
  user: User,
  params: { status?: string; createdBy?: string },
): CustomerListFilter {
  const filter: CustomerListFilter = {};

  if (user.role === "admin" && params.status === "archived") {
    filter.status = "archived";
  }

  const createdBy = params.createdBy?.trim();
  if (user.role === "admin" && createdBy) {
    filter.createdBy = createdBy;
  }

  return filter;
}

export function buildCustomersListQuery(params: {
  status?: "archived";
  createdBy?: string;
}): string {
  const search = new URLSearchParams();
  if (params.status === "archived") {
    search.set("status", "archived");
  }
  if (params.createdBy) {
    search.set("createdBy", params.createdBy);
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}
