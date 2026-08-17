/**
 * Per-dimension D1 queries for Customer State Engine V2 (C2).
 */

import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../../drizzle/schema";
import {
  buildChurnFactsCte,
  buildFirstContactFactsCte,
  buildProfileVerdictSql,
  buildSlaFactsCte,
  refsFromFirstContactFacts,
  refsFromReclamationRow,
  refsFromSlaFacts,
  resolveContext,
  type StateDimensionQueryOptions,
} from "./state-dimension-query-builders";
import {
  buildDimensionFilterBundle,
  countJoinedMultiFilter,
  filterEntries,
  listJoinedMultiFilterIds,
} from "./state-multi-filter-sql";
import {
  buildStateAttentionSqlFromCore,
  buildStateCoreDimensionSql,
  type StateFactRefs,
  type StateListFilter,
} from "./state-sql-dimensions";
import {
  buildNormalizedStageSql,
  buildReclamationExemptSql,
  buildReclamationIdleDaysSql,
} from "./state-sql-primitives";

type Database = ReturnType<typeof drizzle<typeof schema>>;
const c = schema.customers;

export type { StateDimensionQueryOptions };

async function countSingleFilter(
  db: Database,
  dimension: keyof StateListFilter,
  value: string,
  scopeWhere: SQL | undefined,
  options: StateDimensionQueryOptions,
): Promise<number> {
  if (dimension === "attentionLevel") {
    const ids = await listAttentionFilterIds(
      db,
      scopeWhere,
      value,
      options,
    );
    return ids.length;
  }
  const bundle = buildDimensionFilterBundle(
    db,
    "sf_0",
    dimension,
    value,
    scopeWhere,
    options,
  );
  const rows = await db
    .with(...bundle.ctes)
    .select({ count: sql<number>`count(*)` })
    .from(bundle.result);
  return Number(rows[0]?.count ?? 0);
}

async function listSingleFilter(
  db: Database,
  dimension: keyof StateListFilter,
  value: string,
  scopeWhere: SQL | undefined,
  options: StateDimensionQueryOptions,
  pagination?: { limit?: number; offset?: number },
): Promise<string[]> {
  if (dimension === "attentionLevel") {
    return listAttentionFilterIds(
      db,
      scopeWhere,
      value,
      options,
      pagination,
    );
  }
  const bundle = buildDimensionFilterBundle(
    db,
    "sf_0",
    dimension,
    value,
    scopeWhere,
    options,
  );
  let query = db
    .with(...bundle.ctes)
    .select({ id: bundle.result.id })
    .from(bundle.result);
  if (pagination?.limit !== undefined) {
    query = query.limit(pagination.limit) as typeof query;
  }
  if (pagination?.offset !== undefined) {
    query = query.offset(pagination.offset) as typeof query;
  }
  const rows = await query;
  return rows.map((row) => row.id as string);
}

async function queryFirstContactRows(
  db: Database,
  scopeWhere: SQL | undefined,
  options: StateDimensionQueryOptions,
) {
  const { clock, rules, automaticReclaimDays } = resolveContext(options);
  const factsCte = buildFirstContactFactsCte(
    db,
    "state_fc_facts",
    clock,
    scopeWhere,
  );
  const refs = refsFromFirstContactFacts(factsCte);
  const value = buildStateCoreDimensionSql(
    refs,
    rules,
    clock,
    automaticReclaimDays,
  ).firstContact;
  const dimCte = db.$with("state_fc_value").as(
    db
      .select({
        id: factsCte.id,
        value: sql<string>`${value}`.as("value"),
      })
      .from(factsCte)
      .innerJoin(c, eq(c.id, factsCte.id)),
  );
  return db
    .with(factsCte, dimCte)
    .select({ id: dimCte.id, value: dimCte.value })
    .from(dimCte);
}

async function querySlaDimensionRows(
  db: Database,
  scopeWhere: SQL | undefined,
  options: StateDimensionQueryOptions,
  dimension: "followUpSla" | "engagement" | "slaWarningReached",
  includeNextFollowUp: boolean,
) {
  const { clock, rules, automaticReclaimDays } = resolveContext(options);
  const factsCte = buildSlaFactsCte(
    db,
    "state_sla_facts",
    clock,
    rules,
    scopeWhere,
    includeNextFollowUp,
  );
  const refs = refsFromSlaFacts(factsCte);
  const core = buildStateCoreDimensionSql(
    refs,
    rules,
    clock,
    automaticReclaimDays,
  );
  const value = core[dimension];
  const dimCte = db.$with("state_sla_value").as(
    db
      .select({
        id: factsCte.id,
        value: sql<string>`${value}`.as("value"),
      })
      .from(factsCte)
      .innerJoin(c, eq(c.id, factsCte.id)),
  );
  return db
    .with(factsCte, dimCte)
    .select({ id: dimCte.id, value: dimCte.value })
    .from(dimCte);
}

async function queryChurnRows(
  db: Database,
  scopeWhere: SQL | undefined,
  options: StateDimensionQueryOptions,
) {
  const { clock, rules, automaticReclaimDays } = resolveContext(options);
  const { slaFacts, churnCte } = buildChurnFactsCte(
    db,
    "state_sla_facts",
    "state_churn_counts",
    clock,
    rules,
    scopeWhere,
  );
  const refs = refsFromSlaFacts(slaFacts, churnCte);
  const core = buildStateCoreDimensionSql(
    refs,
    rules,
    clock,
    automaticReclaimDays,
  );
  const dimCte = db.$with("state_churn_value").as(
    db
      .select({
        id: slaFacts.id,
        value: sql<string>`${core.churnLevel}`.as("value"),
      })
      .from(slaFacts)
      .innerJoin(churnCte, eq(slaFacts.id, churnCte.id))
      .innerJoin(c, eq(c.id, slaFacts.id)),
  );
  return db
    .with(slaFacts, churnCte, dimCte)
    .select({ id: dimCte.id, value: dimCte.value })
    .from(dimCte);
}

async function queryReclamationRows(
  db: Database,
  scopeWhere: SQL | undefined,
  options: StateDimensionQueryOptions,
) {
  const { clock, rules, automaticReclaimDays } = resolveContext(options);
  const idleDays = buildReclamationIdleDaysSql(clock);
  const exempt = buildReclamationExemptSql(clock);
  const refs = refsFromReclamationRow(idleDays, exempt);
  const value = buildStateCoreDimensionSql(
    refs,
    rules,
    clock,
    automaticReclaimDays,
  ).reclamationRisk;
  let query = db
    .select({
      id: c.id,
      value: sql<string>`${value}`.as("value"),
    })
    .from(c);
  if (scopeWhere) query = query.where(scopeWhere) as typeof query;
  return query;
}

async function queryProfileRows(
  db: Database,
  scopeWhere: SQL | undefined,
  options: StateDimensionQueryOptions,
) {
  const { rules } = resolveContext(options);
  let query = db
    .select({
      id: c.id,
      value: sql<string>`${buildProfileVerdictSql(rules)}`.as("value"),
    })
    .from(c);
  if (scopeWhere) query = query.where(scopeWhere) as typeof query;
  return query;
}

async function queryStageRow(
  db: Database,
  scopeWhere: SQL | undefined,
) {
  const stage = buildNormalizedStageSql();
  let query = db
    .select({ stage: sql<string>`${stage}`.as("stage") })
    .from(c);
  if (scopeWhere) query = query.where(scopeWhere) as typeof query;
  return query;
}

function buildAttentionSqlFromValues(dims: {
  firstContact: string;
  followUpSla: string;
  reclamationRisk: string;
  churnLevel: string;
  slaWarningReached: string;
  stage: string;
}) {
  const quote = (value: string) => sql.raw(`'${value.replace(/'/g, "''")}'`);
  const stage = quote(dims.stage);
  return buildStateAttentionSqlFromCore(
    { stage } as StateFactRefs,
    {
      firstContact: quote(dims.firstContact),
      followUpSla: quote(dims.followUpSla),
      reclamationRisk: quote(dims.reclamationRisk),
      churnLevel: quote(dims.churnLevel),
      slaWarningReached: sql.raw(
        dims.slaWarningReached === "1" || dims.slaWarningReached === "true"
          ? "1"
          : "0",
      ),
    },
  );
}

async function queryAttentionFromDimensionValues(
  db: Database,
  dims: {
    firstContact: string;
    followUpSla: string;
    reclamationRisk: string;
    churnLevel: string;
    slaWarningReached: string;
    stage: string;
  },
) {
  const attention = buildAttentionSqlFromValues(dims);
  const rows = await db
    .select({
      value: sql<string>`${attention}`.as("value"),
    })
    .from(sql`(SELECT 1 AS dummy)`);
  return rows;
}

async function listAttentionFilterIds(
  db: Database,
  scopeWhere: SQL | undefined,
  value: string,
  options: StateDimensionQueryOptions,
  pagination?: { limit?: number; offset?: number },
): Promise<string[]> {
  let query = db.select({ id: c.id }).from(c);
  if (scopeWhere) query = query.where(scopeWhere) as typeof query;
  const scoped = await query;
  const dims = await selectStateDimensionsForCustomers(
    db,
    scoped.map((row) => row.id),
    options,
  );
  let ids = dims
    .filter((row) => row.attentionLevel === value)
    .map((row) => row.id);
  if (pagination?.offset !== undefined) ids = ids.slice(pagination.offset);
  if (pagination?.limit !== undefined) ids = ids.slice(0, pagination.limit);
  return ids;
}

export async function selectStateDimensionsForCustomers(
  db: Database,
  customerIds: string[],
  options: StateDimensionQueryOptions,
) {
  if (customerIds.length === 0) return [];
  const results = [];
  for (const customerId of customerIds) {
    const scopeWhere = eq(c.id, customerId);
    const profileRows = await queryProfileRows(db, scopeWhere, options);
    const firstContactRows = await queryFirstContactRows(
      db,
      scopeWhere,
      options,
    );
    const followUpSlaRows = await querySlaDimensionRows(
      db,
      scopeWhere,
      options,
      "followUpSla",
      true,
    );
    const engagementRows = await querySlaDimensionRows(
      db,
      scopeWhere,
      options,
      "engagement",
      false,
    );
    const churnRows = await queryChurnRows(db, scopeWhere, options);
    const reclamationRows = await queryReclamationRows(
      db,
      scopeWhere,
      options,
    );
    const stageRows = await queryStageRow(db, scopeWhere);
    const slaWarningRows = await querySlaDimensionRows(
      db,
      scopeWhere,
      options,
      "slaWarningReached",
      false,
    );
    const attentionRows = await queryAttentionFromDimensionValues(db, {
      firstContact: firstContactRows[0]!.value,
      followUpSla: followUpSlaRows[0]!.value,
      reclamationRisk: reclamationRows[0]!.value,
      churnLevel: churnRows[0]!.value,
      slaWarningReached: String(slaWarningRows[0]!.value),
      stage: stageRows[0]!.stage,
    });
    results.push({
      id: customerId,
      profileVerdict: profileRows[0]!.value,
      firstContact: firstContactRows[0]!.value,
      followUpSla: followUpSlaRows[0]!.value,
      engagement: engagementRows[0]!.value,
      churnLevel: churnRows[0]!.value,
      reclamationRisk: reclamationRows[0]!.value,
      attentionLevel: attentionRows[0]!.value,
    });
  }
  return results;
}

export async function countCustomersMatchingStateFilter(
  db: Database,
  baseWhere: SQL | undefined,
  filter: StateListFilter,
  options: StateDimensionQueryOptions,
): Promise<number> {
  const entries = filterEntries(filter);
  if (entries.length === 0) {
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(c)
      .where(baseWhere);
    return Number(rows[0]?.count ?? 0);
  }
  if (entries.length === 1) {
    const [dimension, value] = entries[0]!;
    return countSingleFilter(db, dimension, value, baseWhere, options);
  }
  return countJoinedMultiFilter(db, filter, baseWhere, options);
}

export async function listCustomerIdsMatchingStateFilter(
  db: Database,
  baseWhere: SQL | undefined,
  filter: StateListFilter,
  options: StateDimensionQueryOptions & { limit?: number; offset?: number },
): Promise<string[]> {
  const entries = filterEntries(filter);
  if (entries.length === 0) {
    let query = db.select({ id: c.id }).from(c).where(baseWhere);
    if (options.limit !== undefined) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options.offset !== undefined) {
      query = query.offset(options.offset) as typeof query;
    }
    return (await query).map((row) => row.id);
  }
  if (entries.length === 1) {
    const [dimension, value] = entries[0]!;
    return listSingleFilter(db, dimension, value, baseWhere, options, {
      limit: options.limit,
      offset: options.offset,
    });
  }
  return listJoinedMultiFilterIds(db, filter, baseWhere, options, {
    limit: options.limit,
    offset: options.offset,
  });
}

export async function queryProfileVerdicts(
  db: Database,
  scopeWhere: SQL | undefined,
  options: StateDimensionQueryOptions,
) {
  return queryProfileRows(db, scopeWhere, options);
}
