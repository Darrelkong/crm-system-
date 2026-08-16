/**
 * D1 list filter / count / paginate helpers for Customer State Engine V2 (C2).
 *
 * PRE-only: not wired to production list routes.
 */

import { and, sql, type SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../../drizzle/schema";
import {
  buildCustomerListPagination,
  CUSTOMER_LIST_PAGE_SIZE,
} from "@/lib/customers/queries";
import type { BusinessTimezone } from "@/lib/settings/effective";
import {
  countCustomersMatchingStateFilter as countByDimension,
  listCustomerIdsMatchingStateFilter as listByDimension,
  selectStateDimensionsForCustomers as selectDimensions,
} from "./state-dimension-queries";
import { buildStateListFilterOnAliasesSql, type StateListFilter } from "./state-sql-dimensions";

type Database = ReturnType<typeof drizzle<typeof schema>>;

export const CUSTOMER_STATE_FILTER_CANDIDATE_LIMIT = 10_000;

export type StateListQueryOptions = {
  rules?: import("./rules").CustomerStateRules;
  now: Date;
  businessTimezone?: BusinessTimezone;
  automaticReclaimDays?: number;
  limit?: number;
  offset?: number;
};

export function combineCustomerListWhere(
  baseWhere: SQL | undefined,
  extraWhere: SQL | undefined,
): SQL | undefined {
  if (baseWhere && extraWhere) return and(baseWhere, extraWhere);
  return baseWhere ?? extraWhere;
}

export function buildStateFilterWhereSql(
  filter: StateListFilter,
): SQL | undefined {
  return buildStateListFilterOnAliasesSql(filter);
}

export async function countCustomersMatchingStateFilter(
  db: Database,
  baseWhere: SQL | undefined,
  filter: StateListFilter,
  options: StateListQueryOptions,
): Promise<number> {
  return countByDimension(db, baseWhere, filter, options);
}

export async function listCustomerIdsMatchingStateFilter(
  db: Database,
  baseWhere: SQL | undefined,
  filter: StateListFilter,
  options: StateListQueryOptions,
): Promise<string[]> {
  return listByDimension(db, baseWhere, filter, options);
}

export type PaginatedStateCustomerIds = {
  ids: string[];
  pagination: ReturnType<typeof buildCustomerListPagination>;
};

export async function listCustomerIdsMatchingStateFilterPaginated(
  db: Database,
  baseWhere: SQL | undefined,
  filter: StateListFilter,
  page: number,
  options: Omit<StateListQueryOptions, "limit" | "offset">,
  pageSize: number = CUSTOMER_LIST_PAGE_SIZE,
): Promise<PaginatedStateCustomerIds> {
  const total = await countCustomersMatchingStateFilter(
    db,
    baseWhere,
    filter,
    options,
  );
  const pagination = buildCustomerListPagination(total, page, pageSize);
  if (total === 0) {
    return { ids: [], pagination };
  }
  const ids = await listCustomerIdsMatchingStateFilter(db, baseWhere, filter, {
    ...options,
    limit: pagination.pageSize,
    offset: (pagination.page - 1) * pagination.pageSize,
  });
  return { ids, pagination };
}

export async function selectStateDimensionsForCustomers(
  db: Database,
  customerIds: string[],
  options: StateListQueryOptions,
) {
  return selectDimensions(db, customerIds, options);
}

export { queryProfileVerdicts } from "./state-dimension-queries";
