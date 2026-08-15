import {
  and,
  eq,
  getTableColumns,
  sql,
  type SQL,
} from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  buildCustomerListWhere,
  buildCustomerListPagination,
  buildSearchWhere,
  CUSTOMER_LIST_PAGE_SIZE,
  resolveCustomerListOrderBy,
  type CustomerListFilter,
  type ListQueryOptions,
} from "@/lib/customers/queries";
import type { CustomerListPaginationMeta } from "@/lib/customers/customer-list-shared";
import type { EffectiveSettings } from "@/lib/settings/effective";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { User } from "../../../../drizzle/schema/users";
import {
  buildCompletenessBelowSql,
  buildHeatLevelFilterSql,
} from "./scoring-sql-primitives";
import {
  recordScoringCustomerPageLoad,
  recordScoringFallbackCountLoad,
  recordScoringVisibleRowsHydrated,
} from "./scoring-sql-instrumentation";
import type { ScoringListFilter } from "./service";

export const CUSTOMER_SCORING_FILTER_CANDIDATE_LIMIT = 10_000;

/**
 * Compose the authoritative Customer List SQL scoring predicates.
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

export type PaginatedScoringCustomers = {
  items: Customer[];
  pagination: CustomerListPaginationMeta;
};

export type RuntimeScoringListOptions = {
  settings: EffectiveSettings;
  now: Date;
  automaticReclaimDays?: number;
  sortMode?: ListQueryOptions["sortMode"];
  searchQuery?: string;
};

type RuntimeScoringListInternalOptions = RuntimeScoringListOptions & {
  candidateLimit: number;
};

function requireScoringWhere(
  filter: ScoringListFilter,
  settings: EffectiveSettings,
  now: Date,
): SQL {
  const scoringWhere = buildScoringListFilterSql(filter, settings, now);
  if (!scoringWhere) {
    throw new Error("A scoring filter is required");
  }
  return scoringWhere;
}

function normalizeCandidateLimit(candidateLimit: number): number {
  if (!Number.isInteger(candidateLimit) || candidateLimit < 1) {
    throw new Error("candidateLimit must be a positive integer");
  }
  return candidateLimit;
}

function buildRuntimeBaseWhere(
  user: User,
  filter: CustomerListFilter,
  searchQuery: string | undefined,
  now: Date,
): SQL | undefined {
  const term = searchQuery?.trim() ?? "";
  return combineCustomerListWhere(
    buildCustomerListWhere(user, filter, {
      now,
      compactReclamationBindings: true,
    }),
    term ? buildSearchWhere(term) : undefined,
  );
}

function buildRuntimeBaseCandidates(
  db: Database,
  baseWhere: SQL | undefined,
  options: RuntimeScoringListInternalOptions,
) {
  const orderBy = resolveCustomerListOrderBy({
    now: options.now,
    sortMode: options.sortMode,
    automaticReclaimDays:
      options.automaticReclaimDays ?? options.settings.automaticReclaimDays,
  });
  const candidateOrdinal = sql<number>`ROW_NUMBER() OVER (
    ORDER BY ${sql.join(orderBy, sql`, `)}
  )`.as("candidate_ordinal");

  return db.$with("scoring_base_candidates").as(
    db
      .select({
        id: schema.customers.id,
        candidateOrdinal,
      })
      .from(schema.customers)
      .where(baseWhere)
      .orderBy(sql.raw('"candidate_ordinal"'))
      .limit(normalizeCandidateLimit(options.candidateLimit)),
  );
}

function buildRuntimeScoringPageQuery(
  db: Database,
  user: User,
  listFilter: CustomerListFilter,
  scoringFilter: ScoringListFilter,
  offset: number,
  options: RuntimeScoringListInternalOptions,
) {
  const baseWhere = buildRuntimeBaseWhere(
    user,
    listFilter,
    options.searchQuery,
    options.now,
  );
  const baseCandidates = buildRuntimeBaseCandidates(db, baseWhere, options);
  const scoringWhere = requireScoringWhere(
    scoringFilter,
    options.settings,
    options.now,
  );

  return db
    .with(baseCandidates)
    .select({
      ...getTableColumns(schema.customers),
      filteredTotal: sql<number>`COUNT(*) OVER()`
        .mapWith(Number)
        .as("filtered_total"),
    })
    .from(schema.customers)
    .innerJoin(
      baseCandidates,
      eq(schema.customers.id, baseCandidates.id),
    )
    .where(scoringWhere)
    .orderBy(sql`${baseCandidates.candidateOrdinal}`)
    .limit(CUSTOMER_LIST_PAGE_SIZE)
    .offset(offset);
}

function buildRuntimeScoringCountQuery(
  db: Database,
  user: User,
  listFilter: CustomerListFilter,
  scoringFilter: ScoringListFilter,
  options: RuntimeScoringListInternalOptions,
) {
  const baseWhere = buildRuntimeBaseWhere(
    user,
    listFilter,
    options.searchQuery,
    options.now,
  );
  const baseCandidates = buildRuntimeBaseCandidates(db, baseWhere, options);
  const scoringWhere = requireScoringWhere(
    scoringFilter,
    options.settings,
    options.now,
  );

  return db
    .with(baseCandidates)
    .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
    .from(schema.customers)
    .innerJoin(
      baseCandidates,
      eq(schema.customers.id, baseCandidates.id),
    )
    .where(scoringWhere);
}

async function executeRuntimeScoringPageQuery(
  db: Database,
  user: User,
  listFilter: CustomerListFilter,
  scoringFilter: ScoringListFilter,
  page: number,
  kind: "requested" | "fallback",
  options: RuntimeScoringListInternalOptions,
) {
  recordScoringCustomerPageLoad(kind);
  const offset = (page - 1) * CUSTOMER_LIST_PAGE_SIZE;
  return buildRuntimeScoringPageQuery(
    db,
    user,
    listFilter,
    scoringFilter,
    offset,
    options,
  );
}

async function listCustomersMatchingScoringFilterPaginatedInternal(
  db: Database,
  user: User,
  listFilter: CustomerListFilter,
  scoringFilter: ScoringListFilter,
  requestedPage: number,
  options: RuntimeScoringListInternalOptions,
): Promise<PaginatedScoringCustomers> {
  const page = Number.isFinite(requestedPage)
    ? Math.max(1, Math.trunc(requestedPage))
    : 1;
  const requestedRows = await executeRuntimeScoringPageQuery(
    db,
    user,
    listFilter,
    scoringFilter,
    page,
    "requested",
    options,
  );

  if (requestedRows.length > 0) {
    const total = Number(requestedRows[0].filteredTotal);
    const pagination = buildCustomerListPagination(total, page);
    const items = requestedRows.map(({ filteredTotal: _total, ...customer }) =>
      customer as Customer
    );
    recordScoringVisibleRowsHydrated(items.length);
    return { items, pagination };
  }

  if (page === 1) {
    return {
      items: [],
      pagination: buildCustomerListPagination(0, page),
    };
  }

  recordScoringFallbackCountLoad();
  const countRows = await buildRuntimeScoringCountQuery(
    db,
    user,
    listFilter,
    scoringFilter,
    options,
  );
  const total = Number(countRows[0]?.count ?? 0);
  const pagination = buildCustomerListPagination(total, page);
  if (total === 0) {
    return { items: [], pagination };
  }

  const fallbackRows = await executeRuntimeScoringPageQuery(
    db,
    user,
    listFilter,
    scoringFilter,
    pagination.page,
    "fallback",
    options,
  );
  const items = fallbackRows.map(
    ({ filteredTotal: _total, ...customer }) => customer as Customer,
  );
  recordScoringVisibleRowsHydrated(items.length);
  return { items, pagination };
}

/**
 * Runtime Customer List scoring path. The production candidate ceiling is
 * intentionally fixed here and cannot be controlled by request parameters.
 */
export async function listCustomersMatchingScoringFilterPaginated(
  db: Database,
  user: User,
  listFilter: CustomerListFilter,
  scoringFilter: ScoringListFilter,
  requestedPage: number,
  options: RuntimeScoringListOptions,
): Promise<PaginatedScoringCustomers> {
  return listCustomersMatchingScoringFilterPaginatedInternal(
    db,
    user,
    listFilter,
    scoringFilter,
    requestedPage,
    {
      ...options,
      candidateLimit: CUSTOMER_SCORING_FILTER_CANDIDATE_LIMIT,
    },
  );
}

/** Test-only entry point for proving limit-before-scoring with small fixtures. */
export async function listCustomersMatchingScoringFilterPaginatedForTest(
  db: Database,
  user: User,
  listFilter: CustomerListFilter,
  scoringFilter: ScoringListFilter,
  requestedPage: number,
  options: RuntimeScoringListOptions & { candidateLimit: number },
): Promise<PaginatedScoringCustomers> {
  if (process.env.CRM_ALLOW_TEST_DB_BIND !== "1") {
    throw new Error("Test candidate limit is disabled outside verification");
  }
  return listCustomersMatchingScoringFilterPaginatedInternal(
    db,
    user,
    listFilter,
    scoringFilter,
    requestedPage,
    options,
  );
}

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

/** Actual local D1 plan for the production-shaped CTE/window page query. */
export async function explainRuntimeScoringPageQueryPlan(
  db: Database,
  d1: ScoringQueryPlanDatabase,
  user: User,
  listFilter: CustomerListFilter,
  scoringFilter: ScoringListFilter,
  options: RuntimeScoringListOptions,
): Promise<ScoringQueryPlanRow[]> {
  const query = buildRuntimeScoringPageQuery(
    db,
    user,
    listFilter,
    scoringFilter,
    0,
    {
      ...options,
      candidateLimit: CUSTOMER_SCORING_FILTER_CANDIDATE_LIMIT,
    },
  );
  const built = query.toSQL();
  const result = await d1
    .prepare(`EXPLAIN QUERY PLAN ${built.sql}`)
    .bind(...built.params)
    .all<ScoringQueryPlanRow>();

  return result.results;
}
