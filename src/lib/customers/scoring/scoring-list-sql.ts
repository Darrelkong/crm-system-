import { and, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { buildCustomerListOrderBy } from "@/lib/customers/list-sort";
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
  limit?: number;
  offset?: number;
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
  const orderBy = buildCustomerListOrderBy(
    now,
    options.automaticReclaimDays ?? options.settings.automaticReclaimDays,
  );

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

/** Local D1 EXPLAIN QUERY PLAN helper (PRE report only). */
export async function explainScoringFilterQueryPlan(
  db: Database,
  baseWhere: SQL | undefined,
  filter: ScoringListFilter,
  options: ScoringListQueryOptions,
): Promise<string[]> {
  const now = options.now ?? new Date();
  const scoringWhere = buildScoringListFilterSql(filter, options.settings, now);
  const whereClause = combineCustomerListWhere(baseWhere, scoringWhere);

  const rows = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(whereClause)
    .orderBy(
      ...buildCustomerListOrderBy(
        now,
        options.automaticReclaimDays ?? options.settings.automaticReclaimDays,
      ),
    )
    .limit(1);

  void rows;
  return ["query-executed-on-local-d1"];
}
