import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  adminCustomerListStatusWhere,
  staffCustomerListPermissionWhere,
} from "@/lib/customers/customer-list-filters";
import { ON_HOLD_CREATE_APPROVAL_TYPE } from "@/lib/customers/on-hold-create-pending";
import { buildCustomerListOrderBy } from "@/lib/customers/list-sort";
import { buildCustomerListOrderByForMode } from "@/lib/customers/list-sort-reclaim";
import type { CustomerListSortMode } from "@/lib/customers/customer-list-sort";
import {
  buildWorkViewWhere,
  parseWorkView,
  type WorkView,
} from "@/lib/customers/work-view-filter";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";
import { getBusinessTodayRange } from "@/lib/reports/dates";
import {
  isValidAdminOwnerListParam,
  parseAdminOwnerListParam,
  parseSalesStageListParam,
  STAGE_DIST_NOT_SET,
} from "@/lib/customers/sales-stage-list-filter";
import {
  impossibleCustomerMatchSql,
  validInternalCustomerOwnerExistsSql,
} from "@/lib/customers/valid-internal-customer-owner";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";

export { staffAssigneeExistsWhere } from "@/lib/customers/customer-list-filters";

export { buildCustomerListOrderBy, buildFollowUpSort } from "@/lib/customers/list-sort";
export type { CustomerListSortMode } from "@/lib/customers/customer-list-sort";
export {
  buildCustomerListOrderByForMode,
  buildCustomerListReclaimOrderBy,
} from "@/lib/customers/list-sort-reclaim";

type ListQueryOptions = {
  sortMode?: CustomerListSortMode;
  automaticReclaimDays?: number;
  now?: Date;
};

function resolveListOrderBy(options: ListQueryOptions = {}) {
  const now = options.now ?? new Date();
  const sortMode = options.sortMode ?? "default";
  if (sortMode === "reclaim_soonest") {
    const reclaimDays = options.automaticReclaimDays;
    if (reclaimDays != null && Number.isFinite(reclaimDays) && reclaimDays >= 1) {
      return buildCustomerListOrderByForMode(sortMode, reclaimDays, now);
    }
  }
  return buildCustomerListOrderBy(now);
}

export type CustomerListFilter = {
  /** Admin only: `archived` shows archived customers; default excludes archived. */
  status?: "archived";
  /** Admin only: filter by `customers.created_by`. */
  createdBy?: string;
  /** Validated sales stage bucket from dashboard drilldown. */
  salesStage?: string;
  /** Admin only: filter by current `customers.owner_id` (active staff). */
  ownerId?: string;
  /** Server-resolved reclamation risk customer IDs (from action items). */
  reclamationCustomerIds?: string[];
  /** Temporary follow-up drilldown from dashboard cards. */
  workView?: WorkView;
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

/** Escape character for customer search LIKE patterns (must match ESCAPE clause). */
export const CUSTOMER_SEARCH_LIKE_ESCAPE = "\\" as const;

/**
 * Treat user search input as literal text inside a LIKE pattern.
 * Escape `\`, `%`, and `_` so they are not wildcards / escape markers.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[%_\\]/g, "\\$&");
}

/** Parameterized `column LIKE %term% ESCAPE '\'` for literal substring search. */
export function escapedLike(column: AnyColumn, term: string): SQL {
  const pattern = `%${escapeLikePattern(term)}%`;
  return sql`${column} LIKE ${pattern} ESCAPE ${CUSTOMER_SEARCH_LIKE_ESCAPE}`;
}

/** Pending placeholders must not match via customer_name LIKE search. */
export function customerNameIsSearchableByStatus(
  nameStatus: string | null | undefined,
): boolean {
  return nameStatus === "confirmed";
}

/** Exported for unit tests — name match only when name_status is confirmed. */
export function buildSearchWhere(term: string): SQL {
  return or(
    and(
      // Keep aligned with customerNameIsSearchableByStatus("confirmed").
      eq(schema.customers.nameStatus, "confirmed"),
      escapedLike(schema.customers.customerName, term),
    ),
    escapedLike(schema.customers.phone, term),
    escapedLike(schema.customers.wechatId, term),
    escapedLike(schema.customers.email, term),
    escapedLike(schema.customers.customerCode, term),
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

function buildReclamationRiskWhere(
  filter: CustomerListFilter,
): SQL | undefined {
  if (!filter.reclamationCustomerIds) {
    return undefined;
  }
  if (filter.reclamationCustomerIds.length === 0) {
    return sql`1 = 0`;
  }
  return inArray(schema.customers.id, filter.reclamationCustomerIds);
}

function buildWorkViewFilterWhere(
  user: User,
  filter: CustomerListFilter,
): SQL | undefined {
  if (!filter.workView) {
    return undefined;
  }
  const now = new Date();
  const { end: todayEnd } = getBusinessTodayRange(now, HONG_KONG_TIMEZONE);
  const tomorrowStart = new Date(
    new Date(todayEnd).getTime() + 1,
  ).toISOString();
  return buildWorkViewWhere(
    user,
    filter.workView,
    now.toISOString(),
    tomorrowStart,
  );
}

function buildSalesStageWhere(
  filter: CustomerListFilter,
): SQL | undefined {
  if (!filter.salesStage) {
    return undefined;
  }
  if (filter.salesStage === STAGE_DIST_NOT_SET) {
    return sql`trim(${schema.customers.salesStage}) = ''`;
  }
  return eq(schema.customers.salesStage, filter.salesStage);
}

function buildOwnerWhere(
  user: User,
  filter: CustomerListFilter,
): SQL | undefined {
  if (user.role !== "admin" || !filter.ownerId) {
    return undefined;
  }
  // Malformed ownerId must not degrade to an unfiltered admin list.
  if (!isValidAdminOwnerListParam(filter.ownerId)) {
    return impossibleCustomerMatchSql();
  }
  return and(
    eq(schema.customers.ownerId, filter.ownerId),
    validInternalCustomerOwnerExistsSql(),
  );
}

function buildListWhere(
  user: User,
  filter: CustomerListFilter = {},
): SQL | undefined {
  return combineWhere(
    buildPermissionWhere(user, filter),
    buildCreatedByWhere(user, filter),
    buildSalesStageWhere(filter),
    buildOwnerWhere(user, filter),
    buildReclamationRiskWhere(filter),
    buildWorkViewFilterWhere(user, filter),
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
  options: ListQueryOptions = {},
) {
  const db = getDb();
  const whereClause = buildListWhere(user, filter);
  const orderBy = resolveListOrderBy(options);

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
  options: ListQueryOptions = {},
): Promise<PaginatedCustomerListResult> {
  const db = getDb();
  const whereClause = buildListWhere(user, filter);
  const total = await countCustomersWhere(whereClause);
  const pagination = buildCustomerListPagination(total, page);
  const offset = (pagination.page - 1) * pagination.pageSize;
  const orderBy = resolveListOrderBy(options);

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
  options: ListQueryOptions = {},
) {
  const term = query.trim();
  if (!term) {
    return listCustomersForUser(user, filter, limit, options);
  }

  const db = getDb();
  const whereClause = combineWhere(
    buildListWhere(user, filter),
    buildSearchWhere(term),
  );
  const orderBy = resolveListOrderBy(options);

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
  options: ListQueryOptions = {},
): Promise<PaginatedCustomerListResult> {
  const term = query.trim();
  if (!term) {
    return listCustomersForUserPaginated(user, filter, page, options);
  }

  const db = getDb();
  const whereClause = combineWhere(
    buildListWhere(user, filter),
    buildSearchWhere(term),
  );
  const total = await countCustomersWhere(whereClause);
  const pagination = buildCustomerListPagination(total, page);
  const offset = (pagination.page - 1) * pagination.pageSize;
  const orderBy = resolveListOrderBy(options);

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
  params: {
    status?: string;
    createdBy?: string;
    workView?: string;
    salesStage?: string;
    ownerId?: string;
  },
): CustomerListFilter {
  const filter: CustomerListFilter = {};

  if (user.role === "admin" && params.status === "archived") {
    filter.status = "archived";
  }

  const createdBy = params.createdBy?.trim();
  if (user.role === "admin" && createdBy) {
    filter.createdBy = createdBy;
  }

  const salesStage = parseSalesStageListParam(params.salesStage);
  if (salesStage) {
    filter.salesStage = salesStage;
  }

  const rawOwnerId = params.ownerId?.trim();
  if (user.role === "admin" && rawOwnerId) {
    const ownerId = parseAdminOwnerListParam(rawOwnerId);
    // Preserve a non-empty token so buildOwnerWhere can reject malformed ids
    // instead of silently dropping the filter (which would return the full list).
    filter.ownerId = ownerId ?? rawOwnerId;
  }

  const workView = parseWorkView(params.workView);
  if (workView) {
    filter.workView = workView;
  }

  return filter;
}

export function buildCustomersListQuery(params: {
  status?: "archived";
  createdBy?: string;
  salesStage?: string;
  ownerId?: string;
  workView?: string;
  sort?: string;
  heat?: string;
  completenessBelow?: string;
  reclamationRisk?: string;
  page?: number;
}): string {
  const search = new URLSearchParams();
  if (params.status === "archived") {
    search.set("status", "archived");
  }
  if (params.sort && params.sort !== "default") {
    search.set("sort", params.sort);
  }
  if (params.createdBy) {
    search.set("createdBy", params.createdBy);
  }
  if (params.salesStage) {
    search.set("salesStage", params.salesStage);
  }
  if (params.ownerId) {
    search.set("ownerId", params.ownerId);
  }
  if (params.workView) {
    search.set("workView", params.workView);
  }
  if (params.heat) {
    search.set("heat", params.heat);
  }
  if (params.completenessBelow) {
    search.set("completenessBelow", params.completenessBelow);
  }
  if (params.reclamationRisk) {
    search.set("reclamationRisk", params.reclamationRisk);
  }
  if (params.page && params.page > 1) {
    search.set("page", String(params.page));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}
