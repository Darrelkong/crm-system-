/**
 * D1-side multi-dimension filter composition for Customer State Engine V2 (C2).
 *
 * Combined filters are evaluated via INNER JOIN of per-dimension ID CTEs so
 * count / pagination stay in D1 without Worker-side ID materialization.
 */

import { and, eq, sql, type SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../../drizzle/schema";
import { type CustomerStateRules } from "./rules";
import {
  buildProfileVerdictSql,
  buildStateCoreDimensionSql,
  type StateListFilter,
} from "./state-sql-dimensions";
import {
  buildHighIntentStageFromStageSql,
  buildReclamationExemptSql,
  buildReclamationIdleDaysSql,
  type StateSqlClock,
} from "./state-sql-primitives";
import type { StateDimensionQueryOptions } from "./state-dimension-queries";
import {
  buildChurnFactsCte,
  buildFirstContactFactsCte,
  buildSlaFactsCte,
  refsFromFirstContactFacts,
  refsFromReclamationRow,
  refsFromSlaFacts,
  resolveContext,
} from "./state-dimension-query-builders";

type Database = ReturnType<typeof drizzle<typeof schema>>;
const c = schema.customers;

export type DimensionFilterBundle = {
  ctes: Array<ReturnType<Database["$with"]>>;
  result: ReturnType<Database["$with"]> & { id: SQL };
};

function buildProfileFilterBundle(
  db: Database,
  alias: string,
  scopeWhere: SQL | undefined,
  value: string,
  rules: CustomerStateRules,
): DimensionFilterBundle {
  const result = db.$with(alias).as(
    db
      .select({ id: c.id })
      .from(c)
      .where(and(scopeWhere, sql`${buildProfileVerdictSql(rules)} = ${value}`)),
  );
  return { ctes: [result], result: result as DimensionFilterBundle["result"] };
}

function buildFirstContactFilterBundle(
  db: Database,
  alias: string,
  scopeWhere: SQL | undefined,
  value: string,
  clock: StateSqlClock,
  rules: CustomerStateRules,
  automaticReclaimDays: number,
): DimensionFilterBundle {
  const facts = buildFirstContactFactsCte(db, `${alias}_facts`, clock, scopeWhere);
  const fcSql = buildStateCoreDimensionSql(
    refsFromFirstContactFacts(facts),
    rules,
    clock,
    automaticReclaimDays,
  ).firstContact;
  const result = db.$with(alias).as(
    db
      .select({ id: facts.id })
      .from(facts)
      .innerJoin(c, eq(c.id, facts.id))
      .where(sql`${fcSql} = ${value}`),
  );
  return { ctes: [facts, result], result: result as DimensionFilterBundle["result"] };
}

function buildSlaDimensionFilterBundle(
  db: Database,
  alias: string,
  scopeWhere: SQL | undefined,
  value: string,
  dimension: "followUpSla" | "engagement",
  includeNextFollowUp: boolean,
  clock: StateSqlClock,
  rules: CustomerStateRules,
  automaticReclaimDays: number,
): DimensionFilterBundle {
  const facts = buildSlaFactsCte(
    db,
    `${alias}_facts`,
    clock,
    rules,
    scopeWhere,
    includeNextFollowUp,
  );
  const dimSql = buildStateCoreDimensionSql(
    refsFromSlaFacts(facts),
    rules,
    clock,
    automaticReclaimDays,
  )[dimension];
  const result = db.$with(alias).as(
    db
      .select({ id: facts.id })
      .from(facts)
      .innerJoin(c, eq(c.id, facts.id))
      .where(sql`${dimSql} = ${value}`),
  );
  return { ctes: [facts, result], result: result as DimensionFilterBundle["result"] };
}

function buildChurnFilterBundle(
  db: Database,
  alias: string,
  scopeWhere: SQL | undefined,
  value: string,
  clock: StateSqlClock,
  rules: CustomerStateRules,
  automaticReclaimDays: number,
): DimensionFilterBundle {
  const { slaFacts, churnCte } = buildChurnFactsCte(
    db,
    `${alias}_facts`,
    `${alias}_churn`,
    clock,
    rules,
    scopeWhere,
    false,
  );
  const churnSql = buildStateCoreDimensionSql(
    refsFromSlaFacts(slaFacts, churnCte),
    rules,
    clock,
    automaticReclaimDays,
  ).churnLevel;
  const result = db.$with(alias).as(
    db
      .select({ id: slaFacts.id })
      .from(slaFacts)
      .innerJoin(churnCte, eq(slaFacts.id, churnCte.id))
      .innerJoin(c, eq(c.id, slaFacts.id))
      .where(sql`${churnSql} = ${value}`),
  );
  return {
    ctes: [slaFacts, churnCte, result],
    result: result as DimensionFilterBundle["result"],
  };
}

function buildReclamationFilterBundle(
  db: Database,
  alias: string,
  scopeWhere: SQL | undefined,
  value: string,
  clock: StateSqlClock,
  rules: CustomerStateRules,
  automaticReclaimDays: number,
): DimensionFilterBundle {
  const reclaimSql = buildStateCoreDimensionSql(
    refsFromReclamationRow(
      buildReclamationIdleDaysSql(clock),
      buildReclamationExemptSql(clock),
    ),
    rules,
    clock,
    automaticReclaimDays,
  ).reclamationRisk;
  const result = db.$with(alias).as(
    db
      .select({ id: c.id })
      .from(c)
      .where(and(scopeWhere, sql`${reclaimSql} = ${value}`)),
  );
  return { ctes: [result], result: result as DimensionFilterBundle["result"] };
}

function buildSlaWarningFilterBundle(
  db: Database,
  alias: string,
  scopeWhere: SQL | undefined,
  clock: StateSqlClock,
  rules: CustomerStateRules,
  automaticReclaimDays: number,
): DimensionFilterBundle {
  const facts = buildSlaFactsCte(
    db,
    `${alias}_facts`,
    clock,
    rules,
    scopeWhere,
    true,
  );
  const warnSql = buildStateCoreDimensionSql(
    refsFromSlaFacts(facts),
    rules,
    clock,
    automaticReclaimDays,
  ).slaWarningReached;
  const result = db.$with(alias).as(
    db
      .select({ id: facts.id })
      .from(facts)
      .innerJoin(c, eq(c.id, facts.id))
      .where(sql`${warnSql} = 1`),
  );
  return { ctes: [facts, result], result: result as DimensionFilterBundle["result"] };
}

function buildChurnMediumIntentFilterBundle(
  db: Database,
  alias: string,
  scopeWhere: SQL | undefined,
  highIntent: boolean,
  clock: StateSqlClock,
  rules: CustomerStateRules,
  automaticReclaimDays: number,
): DimensionFilterBundle {
  const { slaFacts, churnCte } = buildChurnFactsCte(
    db,
    `${alias}_facts`,
    `${alias}_churn`,
    clock,
    rules,
    scopeWhere,
    false,
  );
  const churnSql = buildStateCoreDimensionSql(
    refsFromSlaFacts(slaFacts, churnCte),
    rules,
    clock,
    automaticReclaimDays,
  ).churnLevel;
  const intentSql = buildHighIntentStageFromStageSql(sql`${slaFacts.stage}`);
  const intentPredicate = highIntent ? intentSql : sql`NOT ${intentSql}`;
  const result = db.$with(alias).as(
    db
      .select({ id: slaFacts.id })
      .from(slaFacts)
      .innerJoin(churnCte, eq(slaFacts.id, churnCte.id))
      .innerJoin(c, eq(c.id, slaFacts.id))
      .where(and(sql`${churnSql} = 'medium'`, intentPredicate)),
  );
  return {
    ctes: [slaFacts, churnCte, result],
    result: result as DimensionFilterBundle["result"],
  };
}

function buildUnionFilterBundle(
  db: Database,
  alias: string,
  branchBundles: DimensionFilterBundle[],
): DimensionFilterBundle {
  if (branchBundles.length === 0) {
    throw new Error("buildUnionFilterBundle requires at least one branch");
  }
  if (branchBundles.length === 1) {
    const only = branchBundles[0]!;
    const result = db.$with(alias).as(
      db.select({ id: only.result.id }).from(only.result),
    );
    return {
      ctes: [...only.ctes, result],
      result: result as DimensionFilterBundle["result"],
    };
  }

  const allCtes = branchBundles.flatMap((bundle) => bundle.ctes);
  const [first, ...rest] = branchBundles.map((bundle) => bundle.result);
  let unionQuery = db
    .with(...allCtes)
    .select({ id: first!.id })
    .from(first!);
  for (const branch of rest) {
    unionQuery = unionQuery.union(
      db.select({ id: branch.id }).from(branch),
    ) as typeof unionQuery;
  }
  const result = db.$with(alias).as(unionQuery);
  return {
    ctes: [...allCtes, result],
    result: result as DimensionFilterBundle["result"],
  };
}

function buildAttentionLevelUnionBundle(
  db: Database,
  alias: string,
  level: "urgent" | "high" | "normal",
  scopeWhere: SQL | undefined,
  clock: StateSqlClock,
  rules: CustomerStateRules,
  automaticReclaimDays: number,
): DimensionFilterBundle {
  return buildUnionFilterBundle(
    db,
    alias,
    buildAttentionBranchBundles(
      db,
      alias,
      level,
      scopeWhere,
      clock,
      rules,
      automaticReclaimDays,
    ),
  );
}

function buildLowAttentionFilterBundle(
  db: Database,
  alias: string,
  scopeWhere: SQL | undefined,
  clock: StateSqlClock,
  rules: CustomerStateRules,
  automaticReclaimDays: number,
): DimensionFilterBundle {
  const urgent = buildAttentionLevelUnionBundle(
    db,
    `${alias}_urgent`,
    "urgent",
    scopeWhere,
    clock,
    rules,
    automaticReclaimDays,
  );
  const high = buildAttentionLevelUnionBundle(
    db,
    `${alias}_high`,
    "high",
    scopeWhere,
    clock,
    rules,
    automaticReclaimDays,
  );
  const normal = buildAttentionLevelUnionBundle(
    db,
    `${alias}_normal`,
    "normal",
    scopeWhere,
    clock,
    rules,
    automaticReclaimDays,
  );
  const scope = db.$with(`${alias}_scope`).as(
    db.select({ id: c.id }).from(c).where(scopeWhere),
  );
  const result = db.$with(alias).as(
    db
      .select({ id: scope.id })
      .from(scope)
      .where(
        sql`${scope.id} NOT IN (SELECT ${urgent.result.id} FROM ${urgent.result})
          AND ${scope.id} NOT IN (SELECT ${high.result.id} FROM ${high.result})
          AND ${scope.id} NOT IN (SELECT ${normal.result.id} FROM ${normal.result})`,
      ),
  );
  return {
    ctes: [...urgent.ctes, ...high.ctes, ...normal.ctes, scope, result],
    result: result as DimensionFilterBundle["result"],
  };
}

function buildAttentionFilterBundle(
  db: Database,
  alias: string,
  scopeWhere: SQL | undefined,
  value: string,
  clock: StateSqlClock,
  rules: CustomerStateRules,
  automaticReclaimDays: number,
): DimensionFilterBundle {
  if (value === "low") {
    return buildLowAttentionFilterBundle(
      db,
      alias,
      scopeWhere,
      clock,
      rules,
      automaticReclaimDays,
    );
  }

  const level = value as "urgent" | "high" | "normal";
  return buildAttentionLevelUnionBundle(
    db,
    alias,
    level,
    scopeWhere,
    clock,
    rules,
    automaticReclaimDays,
  );
}

function buildAttentionBranchBundles(
  db: Database,
  alias: string,
  level: "urgent" | "high" | "normal",
  scopeWhere: SQL | undefined,
  clock: StateSqlClock,
  rules: CustomerStateRules,
  automaticReclaimDays: number,
): DimensionFilterBundle[] {
  const branch = (
    suffix: string,
    builder: (branchAlias: string) => DimensionFilterBundle,
  ) => builder(`${alias}_${suffix}`);

  if (level === "urgent") {
    return [
      branch("fc", (a) =>
        buildFirstContactFilterBundle(
          db,
          a,
          scopeWhere,
          "critical",
          clock,
          rules,
          automaticReclaimDays,
        ),
      ),
      branch("sla", (a) =>
        buildSlaDimensionFilterBundle(
          db,
          a,
          scopeWhere,
          "severe_overdue",
          "followUpSla",
          true,
          clock,
          rules,
          automaticReclaimDays,
        ),
      ),
      branch("reclaim_final", (a) =>
        buildReclamationFilterBundle(
          db,
          a,
          scopeWhere,
          "final",
          clock,
          rules,
          automaticReclaimDays,
        ),
      ),
      branch("reclaim_due", (a) =>
        buildReclamationFilterBundle(
          db,
          a,
          scopeWhere,
          "due",
          clock,
          rules,
          automaticReclaimDays,
        ),
      ),
      branch("churn", (a) =>
        buildChurnFilterBundle(
          db,
          a,
          scopeWhere,
          "high",
          clock,
          rules,
          automaticReclaimDays,
        ),
      ),
    ];
  }

  if (level === "high") {
    return [
      branch("fc", (a) =>
        buildFirstContactFilterBundle(
          db,
          a,
          scopeWhere,
          "overdue",
          clock,
          rules,
          automaticReclaimDays,
        ),
      ),
      branch("sla", (a) =>
        buildSlaDimensionFilterBundle(
          db,
          a,
          scopeWhere,
          "overdue",
          "followUpSla",
          true,
          clock,
          rules,
          automaticReclaimDays,
        ),
      ),
      branch("reclaim", (a) =>
        buildReclamationFilterBundle(
          db,
          a,
          scopeWhere,
          "warning",
          clock,
          rules,
          automaticReclaimDays,
        ),
      ),
      branch("churn_intent", (a) =>
        buildChurnMediumIntentFilterBundle(
          db,
          a,
          scopeWhere,
          true,
          clock,
          rules,
          automaticReclaimDays,
        ),
      ),
      branch("sla_warn", (a) =>
        buildSlaWarningFilterBundle(
          db,
          a,
          scopeWhere,
          clock,
          rules,
          automaticReclaimDays,
        ),
      ),
    ];
  }

  return [
    branch("fc", (a) =>
      buildFirstContactFilterBundle(
        db,
        a,
        scopeWhere,
        "due_soon",
        clock,
        rules,
        automaticReclaimDays,
      ),
    ),
    branch("sla", (a) =>
      buildSlaDimensionFilterBundle(
        db,
        a,
        scopeWhere,
        "due_soon",
        "followUpSla",
        true,
        clock,
        rules,
        automaticReclaimDays,
      ),
    ),
    branch("reclaim", (a) =>
      buildReclamationFilterBundle(
        db,
        a,
        scopeWhere,
        "approaching",
        clock,
        rules,
        automaticReclaimDays,
      ),
    ),
    branch("churn_intent", (a) =>
      buildChurnMediumIntentFilterBundle(
        db,
        a,
        scopeWhere,
        false,
        clock,
        rules,
        automaticReclaimDays,
      ),
    ),
  ];
}

export function buildDimensionFilterBundle(
  db: Database,
  alias: string,
  dimension: keyof StateListFilter,
  value: string,
  scopeWhere: SQL | undefined,
  options: StateDimensionQueryOptions,
): DimensionFilterBundle {
  const { clock, rules, automaticReclaimDays } = resolveContext(options);
  switch (dimension) {
    case "profileVerdict":
      return buildProfileFilterBundle(
        db,
        alias,
        scopeWhere,
        value,
        rules,
      );
    case "firstContact":
      return buildFirstContactFilterBundle(
        db,
        alias,
        scopeWhere,
        value,
        clock,
        rules,
        automaticReclaimDays,
      );
    case "followUpSla":
      return buildSlaDimensionFilterBundle(
        db,
        alias,
        scopeWhere,
        value,
        "followUpSla",
        true,
        clock,
        rules,
        automaticReclaimDays,
      );
    case "engagement":
      return buildSlaDimensionFilterBundle(
        db,
        alias,
        scopeWhere,
        value,
        "engagement",
        false,
        clock,
        rules,
        automaticReclaimDays,
      );
    case "churnLevel":
      return buildChurnFilterBundle(
        db,
        alias,
        scopeWhere,
        value,
        clock,
        rules,
        automaticReclaimDays,
      );
    case "reclamationRisk":
      return buildReclamationFilterBundle(
        db,
        alias,
        scopeWhere,
        value,
        clock,
        rules,
        automaticReclaimDays,
      );
    case "attentionLevel":
      return buildAttentionFilterBundle(
        db,
        alias,
        scopeWhere,
        value,
        clock,
        rules,
        automaticReclaimDays,
      );
    default: {
      const _exhaustive: never = dimension;
      throw new Error(`Unknown filter dimension: ${_exhaustive}`);
    }
  }
}

export function filterEntries(
  filter: StateListFilter,
): Array<[keyof StateListFilter, string]> {
  const entries: Array<[keyof StateListFilter, string]> = [];
  (Object.keys(filter) as Array<keyof StateListFilter>).forEach((key) => {
    const value = filter[key];
    if (value !== undefined) {
      entries.push([key, value]);
    }
  });
  return entries;
}

type JoinedFilterQuery = {
  allCtes: Array<ReturnType<Database["$with"]>>;
  primary: DimensionFilterBundle["result"];
  joins: Array<DimensionFilterBundle["result"]>;
};

export function buildJoinedMultiFilterQuery(
  db: Database,
  filter: StateListFilter,
  scopeWhere: SQL | undefined,
  options: StateDimensionQueryOptions,
): JoinedFilterQuery | null {
  const entries = filterEntries(filter);
  if (entries.length <= 1) return null;

  const bundles = entries.map(([dimension, value], index) =>
    buildDimensionFilterBundle(
      db,
      `mf_${index}`,
      dimension,
      value,
      scopeWhere,
      options,
    ),
  );

  const allCtes = bundles.flatMap((bundle) => bundle.ctes);
  const primary = bundles[0]!.result;
  const joins = bundles.slice(1).map((bundle) => bundle.result);
  return { allCtes, primary, joins };
}

export async function countJoinedMultiFilter(
  db: Database,
  filter: StateListFilter,
  scopeWhere: SQL | undefined,
  options: StateDimensionQueryOptions,
): Promise<number> {
  const joined = buildJoinedMultiFilterQuery(db, filter, scopeWhere, options);
  if (!joined) {
    throw new Error("countJoinedMultiFilter requires 2+ filter dimensions");
  }
  const { allCtes, primary, joins } = joined;
  // Drizzle join chaining widens the builder type across each innerJoin.
  let query = db
    .with(...allCtes)
    .select({ count: sql<number>`count(*)` })
    .from(primary);
  for (const joinCte of joins) {
    query = query.innerJoin(joinCte, eq(primary.id, joinCte.id)) as typeof query;
  }
  const rows = await query;
  return Number(rows[0]?.count ?? 0);
}

export async function listJoinedMultiFilterIds(
  db: Database,
  filter: StateListFilter,
  scopeWhere: SQL | undefined,
  options: StateDimensionQueryOptions,
  pagination?: { limit?: number; offset?: number },
): Promise<string[]> {
  const joined = buildJoinedMultiFilterQuery(db, filter, scopeWhere, options);
  if (!joined) {
    throw new Error("listJoinedMultiFilterIds requires 2+ filter dimensions");
  }
  const { allCtes, primary, joins } = joined;
  let query = db
    .with(...allCtes)
    .select({ id: primary.id })
    .from(primary);
  for (const joinCte of joins) {
    query = query.innerJoin(joinCte, eq(primary.id, joinCte.id)) as typeof query;
  }
  if (pagination?.limit !== undefined) {
    query = query.limit(pagination.limit) as typeof query;
  }
  if (pagination?.offset !== undefined) {
    query = query.offset(pagination.offset) as typeof query;
  }
  const rows = await query;
  return rows.map((row) => row.id as string);
}
