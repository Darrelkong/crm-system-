import { and, asc, eq, like, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  adminCustomerListStatusWhere,
  staffAssigneeExistsWhere,
  staffCustomerListPermissionWhere,
} from "@/lib/customers/customer-list-filters";
import { ON_HOLD_CREATE_APPROVAL_TYPE } from "@/lib/customers/on-hold-create-pending";
import { buildCustomerListOrderBy } from "@/lib/customers/list-sort";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";

export { staffAssigneeExistsWhere } from "@/lib/customers/customer-list-filters";

export { buildCustomerListOrderBy, buildFollowUpSort } from "@/lib/customers/list-sort";

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

export const CUSTOMER_LIST_PAGE_SIZE = 40;

export type CustomerListPaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};

export type PaginatedCustomerListResult = {
  items: Customer[];
  pagination: CustomerListPaginationMeta;
};

export function parseCustomerListPageParams(params: {
  page?: string | number | null;
}): { page: number; pageSize: number; offset: number } {
  const pageSize = CUSTOMER_LIST_PAGE_SIZE;
  let page = 1;

  if (params.page != null) {
    const parsed =
      typeof params.page === "number"
        ? params.page
        : Number.parseInt(String(params.page), 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      page = parsed;
    }
  }

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
}

export function buildCustomerListPagination(
  total: number,
  page: number,
  pageSize: number = CUSTOMER_LIST_PAGE_SIZE,
): CustomerListPaginationMeta {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const normalizedPage = Math.min(Math.max(page, 1), pageCount);

  return {
    page: normalizedPage,
    pageSize,
    total,
    pageCount,
  };
}

function buildPermissionWhere(
  user: User,
  filter: CustomerListFilter = {},
): SQL | undefined {
  if (user.role === "admin") {
    return adminCustomerListStatusWhere(filter);
  }

  return staffCustomerListPermissionWhere(user.id);
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

/** Hide customers awaiting admin approval for staff on_hold create (D-1b-2). */
export function excludePendingOnHoldCreateApprovalWhere(): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM approvals
    WHERE approvals.customer_id = ${schema.customers.id}
      AND approvals.request_type = ${ON_HOLD_CREATE_APPROVAL_TYPE}
      AND approvals.status = 'pending'
  )`;
}

function buildListWhere(
  user: User,
  filter: CustomerListFilter = {},
): SQL | undefined {
  return combineWhere(
    buildPermissionWhere(user, filter),
    buildCreatedByWhere(user, filter),
    excludePendingOnHoldCreateApprovalWhere(),
  );
}

export async function listCustomerCreatorsForAdmin(
  filter: CustomerListFilter = {},
): Promise<CustomerCreatorOption[]> {
  const db = getDb();
  const statusWhere = adminCustomerListStatusWhere(filter);

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

async function countCustomersWhere(whereClause: SQL | undefined): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.customers)
    .where(whereClause);
  return Number(rows[0]?.count ?? 0);
}

export async function listCustomersForUser(
  user: User,
  filter: CustomerListFilter = {},
  limit = 100,
) {
  const db = getDb();
  const whereClause = buildListWhere(user, filter);
  const orderBy = buildCustomerListOrderBy();

  return db
    .select()
    .from(schema.customers)
    .where(whereClause)
    .orderBy(...orderBy)
    .limit(limit);
}

export async function listCustomersForUserPaginated(
  user: User,
  filter: CustomerListFilter = {},
  page = 1,
): Promise<PaginatedCustomerListResult> {
  const db = getDb();
  const whereClause = buildListWhere(user, filter);
  const total = await countCustomersWhere(whereClause);
  const pagination = buildCustomerListPagination(total, page);
  const offset = (pagination.page - 1) * pagination.pageSize;
  const orderBy = buildCustomerListOrderBy();

  const items =
    total === 0
      ? []
      : await db
          .select()
          .from(schema.customers)
          .where(whereClause)
          .orderBy(...orderBy)
          .limit(pagination.pageSize)
          .offset(offset);

  return { items, pagination };
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
    buildListWhere(user, filter),
    buildSearchWhere(term),
  );
  const orderBy = buildCustomerListOrderBy();

  return db
    .select()
    .from(schema.customers)
    .where(whereClause)
    .orderBy(...orderBy)
    .limit(limit);
}

export async function searchCustomersForUserPaginated(
  user: User,
  query: string,
  filter: CustomerListFilter = {},
  page = 1,
): Promise<PaginatedCustomerListResult> {
  const term = query.trim();
  if (!term) {
    return listCustomersForUserPaginated(user, filter, page);
  }

  const db = getDb();
  const whereClause = combineWhere(
    buildListWhere(user, filter),
    buildSearchWhere(term),
  );
  const total = await countCustomersWhere(whereClause);
  const pagination = buildCustomerListPagination(total, page);
  const offset = (pagination.page - 1) * pagination.pageSize;
  const orderBy = buildCustomerListOrderBy();

  const items =
    total === 0
      ? []
      : await db
          .select()
          .from(schema.customers)
          .where(whereClause)
          .orderBy(...orderBy)
          .limit(pagination.pageSize)
          .offset(offset);

  return { items, pagination };
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
  page?: number;
}): string {
  const search = new URLSearchParams();
  if (params.status === "archived") {
    search.set("status", "archived");
  }
  if (params.createdBy) {
    search.set("createdBy", params.createdBy);
  }
  if (params.page && params.page > 1) {
    search.set("page", String(params.page));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}
