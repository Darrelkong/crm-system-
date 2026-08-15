import { and, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  buildCustomerListPagination,
  resolveCustomerListOrderBy,
  type ListQueryOptions,
} from "@/lib/customers/queries";
import type { CustomerListPaginationMeta } from "@/lib/customers/customer-list-shared";
import type { EffectiveSettings } from "@/lib/settings/effective";
import {
  buildCompletenessBelowSql,
  buildHeatLevelFilterSql,
} from "./scoring-sql-primitives";
import type { ScoringListFilter } from "./service";

/**
 * Compose scoring predicates for eventual Customer List SQL filtering.
 * PRE phase only — not used by production page/API routes.
 */
export function buildScoringListFilterSql(
  filter: ScoringListFilter,
  settings: EffectiveSettings,
  now: Date = new Date(),
): SQL | undefined {
  const parts: SQL[] = [];

  if (filter.heat) {
    parts.push(buildHeatLevelFilterSql(filter.heat, settings, now));
  }
  if (filter.completenessBelow !== undefined) {
    parts.push(buildCompletenessBelowSql(filter.completenessBelow));
  }

  if (parts.length === 0) {
    return undefined;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return and(...parts);
}

export function combineCustomerListWhere(
  baseWhere: SQL | undefined,
  scoringWhere: SQL | undefined,
): SQL | undefined {
  if (!baseWhere && !scoringWhere) {
    return undefined;
  }
  if (!baseWhere) {
    return scoringWhere;
  }
  if (!scoringWhere) {
    return baseWhere;
  }
  return and(baseWhere, scoringWhere);
}

export type ScoringListQueryOptions = {
  settings: EffectiveSettings;
  now?: Date;
  automaticReclaimDays?: number;
  sortMode?: ListQueryOptions["sortMode"];
  limit?: number;
  offset?: number;
};

export type ScoringQueryPlanRow = {
  id: number;
  parent: number;
  notused: number;
  detail: string;
};

export type ScoringQueryPlanDatabase = {
  prepare(query: string): {
    bind(...params: unknown[]): {
      all<T>(): Promise<{ results: T[] }>;
    };
  };
};

export type PaginatedScoringCustomerIds = {
  ids: string[];
  pagination: CustomerListPaginationMeta;
};

/** Candidate COUNT for scoring-filtered customer list (PRE only). */
export async function countCustomersMatchingScoringFilter(
  db: Database,
  baseWhere: SQL | undefined,
  filter: ScoringListFilter,
  options: ScoringListQueryOptions,
): Promise<number> {
  const now = options.now ?? new Date();
  const scoringWhere = buildScoringListFilterSql(filter, options.settings, now);
  const whereClause = combineCustomerListWhere(baseWhere, scoringWhere);

  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.customers)
    .where(whereClause);

  return Number(rows[0]?.count ?? 0);
}

/** Candidate page SELECT for scoring-filtered customer list (PRE only). */
export async function listCustomerIdsMatchingScoringFilter(
  db: Database,
  baseWhere: SQL | undefined,
  filter: ScoringListFilter,
  options: ScoringListQueryOptions,
): Promise<string[]> {
  const now = options.now ?? new Date();
  const scoringWhere = buildScoringListFilterSql(filter, options.settings, now);
  const whereClause = combineCustomerListWhere(baseWhere, scoringWhere);
  const orderBy = resolveCustomerListOrderBy({
    now,
    sortMode: options.sortMode,
    automaticReclaimDays:
      options.automaticReclaimDays ?? options.settings.automaticReclaimDays,
  });

  let query = db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(whereClause)
    .orderBy(...orderBy);

  if (options.limit !== undefined) {
    query = query.limit(options.limit) as typeof query;
  }
  if (options.offset !== undefined) {
    query = query.offset(options.offset) as typeof query;
  }

  const rows = await query;
  return rows.map((row) => row.id);
}

/** Candidate normalized COUNT + page SELECT shape (PRE only). */
export async function listCustomerIdsMatchingScoringFilterPaginated(
  db: Database,
  baseWhere: SQL | undefined,
  filter: ScoringListFilter,
  page: number,
  options: Omit<ScoringListQueryOptions, "limit" | "offset">,
): Promise<PaginatedScoringCustomerIds> {
  const total = await countCustomersMatchingScoringFilter(
    db,
    baseWhere,
    filter,
    options,
  );
  const pagination = buildCustomerListPagination(total, page);
  if (total === 0) {
    return { ids: [], pagination };
  }
  const ids = await listCustomerIdsMatchingScoringFilter(
    db,
    baseWhere,
    filter,
    {
      ...options,
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
    },
  );
  return { ids, pagination };
}

/** Local D1 EXPLAIN QUERY PLAN helper (PRE report only). */
export async function explainScoringFilterQueryPlan(
  db: Database,
  d1: ScoringQueryPlanDatabase,
  baseWhere: SQL | undefined,
  filter: ScoringListFilter,
  options: ScoringListQueryOptions,
): Promise<ScoringQueryPlanRow[]> {
  const now = options.now ?? new Date();
  const scoringWhere = buildScoringListFilterSql(filter, options.settings, now);
  const whereClause = combineCustomerListWhere(baseWhere, scoringWhere);

  const query = db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(whereClause)
    .orderBy(
      ...resolveCustomerListOrderBy({
        now,
        sortMode: options.sortMode,
        automaticReclaimDays:
          options.automaticReclaimDays ?? options.settings.automaticReclaimDays,
      }),
    )
    .limit(1);
  const built = query.toSQL();
  const result = await d1
    .prepare(`EXPLAIN QUERY PLAN ${built.sql}`)
    .bind(...built.params)
    .all<ScoringQueryPlanRow>();

  return result.results;
}
