/**
 * Per-dimension D1 queries for Customer State Engine V2 (C2).
 */

import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../../drizzle/schema";
import type { BusinessTimezone } from "@/lib/settings/effective";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";
import { DEFAULT_CUSTOMER_STATE_RULES, type CustomerStateRules } from "./rules";
import {
  buildProfileVerdictSql,
  buildStageThresholdColumnsSql,
  buildStateAttentionSqlFromCore,
  buildStateCoreDimensionSql,
  type StateFactRefs,
  type StateListFilter,
} from "./state-sql-dimensions";
import {
  buildChurnFamilyCSql,
  buildChurnOutcomeCountSql,
  buildNormalizedStageSql,
  buildParsedLastValidSql,
  buildParsedNextFollowUpSql,
  buildReclamationExemptSql,
  buildReclamationIdleDaysSql,
  buildStateCalendarDaysSinceSql,
  buildStateElapsedHoursSql,
  buildStateInstantSql,
  buildStateSqlClock,
  stateSqlFieldHasText,
  type StateSqlClock,
} from "./state-sql-primitives";

type Database = ReturnType<typeof drizzle<typeof schema>>;
const c = schema.customers;

export type StateDimensionQueryOptions = {
  rules?: CustomerStateRules;
  now: Date;
  businessTimezone?: BusinessTimezone;
  automaticReclaimDays?: number;
};

function resolveContext(options: StateDimensionQueryOptions) {
  const timezone = options.businessTimezone ?? HONG_KONG_TIMEZONE;
  return {
    clock: buildStateSqlClock(options.now, timezone),
    rules: options.rules ?? DEFAULT_CUSTOMER_STATE_RULES,
    automaticReclaimDays: options.automaticReclaimDays ?? 55,
  };
}

function buildFirstContactAnchorSql(): SQL {
  return sql`CASE
    WHEN ${stateSqlFieldHasText(c.reclamationCycleStartedAt)}
      THEN ${buildStateInstantSql(c.reclamationCycleStartedAt)}
    ELSE ${buildStateInstantSql(c.createdAt)}
  END`;
}

function buildThresholdRefs(
  stage: SQL,
  rules: CustomerStateRules,
): Pick<
  StateFactRefs,
  "thresholdTarget" | "thresholdWarning" | "thresholdOverdue" | "thresholdSevere"
> {
  const thresholds = buildStageThresholdColumnsSql(stage, rules);
  return {
    thresholdTarget: thresholds.target,
    thresholdWarning: thresholds.warning,
    thresholdOverdue: thresholds.overdue,
    thresholdSevere: thresholds.severe,
  };
}

function buildSlaFactsCte(
  db: Database,
  clock: StateSqlClock,
  rules: CustomerStateRules,
  scopeWhere: SQL | undefined,
  includeNextFollowUp: boolean,
) {
  const stage = buildNormalizedStageSql();
  const parsedLastValid = buildParsedLastValidSql();
  const daysSinceValid = sql`CASE
    WHEN ${parsedLastValid} IS NULL THEN NULL
    ELSE ${buildStateCalendarDaysSinceSql(parsedLastValid, clock)}
  END`;
  const thresholds = buildThresholdRefs(stage, rules);

  let query = db
    .select({
      id: c.id,
      stage: sql<string>`${stage}`.as("stage"),
      parsedLastValid: sql<string | null>`${parsedLastValid}`.as(
        "parsed_last_valid",
      ),
      parsedNextFollowUp: includeNextFollowUp
        ? sql<string | null>`${buildParsedNextFollowUpSql()}`.as(
            "parsed_next_follow_up",
          )
        : sql<string | null>`NULL`.as("parsed_next_follow_up"),
      daysSinceValid: sql<number | null>`${daysSinceValid}`.as(
        "days_since_valid",
      ),
      thresholdTarget: sql<number | null>`${thresholds.thresholdTarget}`.as(
        "threshold_target",
      ),
      thresholdWarning: sql<number | null>`${thresholds.thresholdWarning}`.as(
        "threshold_warning",
      ),
      thresholdOverdue: sql<number | null>`${thresholds.thresholdOverdue}`.as(
        "threshold_overdue",
      ),
      thresholdSevere: sql<number | null>`${thresholds.thresholdSevere}`.as(
        "threshold_severe",
      ),
    })
    .from(c);
  if (scopeWhere) query = query.where(scopeWhere) as typeof query;
  return db.$with("state_sla_facts").as(query);
}

function buildFirstContactFactsCte(
  db: Database,
  clock: StateSqlClock,
  scopeWhere: SQL | undefined,
) {
  const stage = buildNormalizedStageSql();
  const parsedLastValid = buildParsedLastValidSql();
  const fcAnchor = buildFirstContactAnchorSql();
  const fcAgeHours = sql`CASE
    WHEN ${fcAnchor} IS NULL THEN NULL
    ELSE ${buildStateElapsedHoursSql(fcAnchor, clock)}
  END`;

  let query = db
    .select({
      id: c.id,
      stage: sql<string>`${stage}`.as("stage"),
      parsedLastValid: sql<string | null>`${parsedLastValid}`.as(
        "parsed_last_valid",
      ),
      fcAgeHours: sql<number | null>`${fcAgeHours}`.as("fc_age_hours"),
    })
    .from(c);
  if (scopeWhere) query = query.where(scopeWhere) as typeof query;
  return db.$with("state_fc_facts").as(query);
}

function buildChurnFactsCte(
  db: Database,
  clock: StateSqlClock,
  rules: CustomerStateRules,
  scopeWhere: SQL | undefined,
  includeNextFollowUp = false,
) {
  const slaFacts = buildSlaFactsCte(
    db,
    clock,
    rules,
    scopeWhere,
    includeNextFollowUp,
  );
  const parsedLastValid = sql`${slaFacts.parsedLastValid}`;
  const churnCte = db.$with("state_churn_counts").as(
    db
      .select({
        id: slaFacts.id,
        noReplyCount: sql<number>`${buildChurnOutcomeCountSql(
          parsedLastValid,
          clock,
          60,
          "'no_reply'",
          sql`${slaFacts.id}`,
        )}`.as("no_reply_count"),
        noContactCount: sql<number>`${buildChurnOutcomeCountSql(
          parsedLastValid,
          clock,
          60,
          "'no_contact'",
          sql`${slaFacts.id}`,
        )}`.as("no_contact_count"),
        familyC: sql<number>`${buildChurnFamilyCSql(
          parsedLastValid,
          sql`${slaFacts.id}`,
        )}`.as("family_c"),
      })
      .from(slaFacts),
  );
  return { slaFacts, churnCte };
}

function refsFromSlaFacts(
  facts: ReturnType<typeof buildSlaFactsCte>,
  churn?: ReturnType<typeof buildChurnFactsCte>["churnCte"],
): StateFactRefs {
  return {
    stage: sql`${facts.stage}`,
    parsedLastValid: sql`${facts.parsedLastValid}`,
    parsedNextFollowUp: sql`${facts.parsedNextFollowUp}`,
    daysSinceValid: sql`${facts.daysSinceValid}`,
    reclamationIdleDays: sql`0`,
    reclamationExempt: sql`0`,
    noReplyCount: churn?.noReplyCount ? sql`${churn.noReplyCount}` : sql`0`,
    noContactCount: churn?.noContactCount ? sql`${churn.noContactCount}` : sql`0`,
    familyC: churn?.familyC ? sql`${churn.familyC}` : sql`0`,
    thresholdTarget: sql`${facts.thresholdTarget}`,
    thresholdWarning: sql`${facts.thresholdWarning}`,
    thresholdOverdue: sql`${facts.thresholdOverdue}`,
    thresholdSevere: sql`${facts.thresholdSevere}`,
  };
}

function refsFromFirstContactFacts(
  facts: ReturnType<typeof buildFirstContactFactsCte>,
): StateFactRefs {
  return {
    stage: sql`${facts.stage}`,
    parsedLastValid: sql`${facts.parsedLastValid}`,
    parsedNextFollowUp: sql`NULL`,
    daysSinceValid: sql`NULL`,
    reclamationIdleDays: sql`0`,
    reclamationExempt: sql`0`,
    noReplyCount: sql`0`,
    noContactCount: sql`0`,
    familyC: sql`0`,
    fcAgeHours: sql`${facts.fcAgeHours}`,
  };
}

function refsFromReclamationRow(
  idleDays: SQL,
  exempt: SQL,
): StateFactRefs {
  return {
    stage: sql`'new_lead'`,
    parsedLastValid: sql`NULL`,
    parsedNextFollowUp: sql`NULL`,
    daysSinceValid: sql`NULL`,
    reclamationIdleDays: idleDays,
    reclamationExempt: exempt,
    noReplyCount: sql`0`,
    noContactCount: sql`0`,
    familyC: sql`0`,
  };
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

async function queryFirstContactRows(
  db: Database,
  scopeWhere: SQL | undefined,
  options: StateDimensionQueryOptions,
) {
  const { clock, rules, automaticReclaimDays } = resolveContext(options);
  const factsCte = buildFirstContactFactsCte(db, clock, scopeWhere);
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

async function querySlaWarningRow(
  db: Database,
  scopeWhere: SQL | undefined,
  options: StateDimensionQueryOptions,
) {
  const rows = await querySlaDimensionRows(
    db,
    scopeWhere,
    options,
    "slaWarningReached",
    false,
  );
  return rows;
}

function buildAttentionSqlFromValues(
  dims: {
    firstContact: string;
    followUpSla: string;
    reclamationRisk: string;
    churnLevel: string;
    slaWarningReached: string;
    stage: string;
  },
) {
  const quote = (value: string) => sql.raw(`'${value.replace(/'/g, "''")}'`);
  const stage = quote(dims.stage);
  const highIntent = sql`${stage} IN ('interested', 'proposal', 'negotiation')`;
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
    const slaWarningRows = await querySlaWarningRow(db, scopeWhere, options);
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

const FILTER_HANDLERS: Record<
  keyof StateListFilter,
  (
    db: Database,
    scopeWhere: SQL | undefined,
    value: string,
    options: StateDimensionQueryOptions,
    limit?: number,
    offset?: number,
  ) => Promise<string[]>
> = {
  profileVerdict: async (db, scopeWhere, value, options, limit, offset) => {
    const { rules } = resolveContext(options);
    let query = db
      .select({ id: c.id })
      .from(c)
      .where(
        and(scopeWhere, sql`${buildProfileVerdictSql(rules)} = ${value}`),
      );
    if (limit !== undefined) query = query.limit(limit) as typeof query;
    if (offset !== undefined) query = query.offset(offset) as typeof query;
    return (await query).map((row) => row.id);
  },
  firstContact: async (db, scopeWhere, value, options, limit, offset) => {
    const { clock, rules, automaticReclaimDays } = resolveContext(options);
    const factsCte = buildFirstContactFactsCte(db, clock, scopeWhere);
    const fcSql = buildStateCoreDimensionSql(
      refsFromFirstContactFacts(factsCte),
      rules,
      clock,
      automaticReclaimDays,
    ).firstContact;
    let query = db
      .with(factsCte)
      .select({ id: factsCte.id })
      .from(factsCte)
      .innerJoin(c, eq(c.id, factsCte.id))
      .where(sql`${fcSql} = ${value}`);
    if (limit !== undefined) query = query.limit(limit) as typeof query;
    if (offset !== undefined) query = query.offset(offset) as typeof query;
    return (await query).map((row) => row.id);
  },
  followUpSla: async (db, scopeWhere, value, options, limit, offset) => {
    const { clock, rules, automaticReclaimDays } = resolveContext(options);
    const factsCte = buildSlaFactsCte(db, clock, rules, scopeWhere, true);
    const slaSql = buildStateCoreDimensionSql(
      refsFromSlaFacts(factsCte),
      rules,
      clock,
      automaticReclaimDays,
    ).followUpSla;
    let query = db
      .with(factsCte)
      .select({ id: factsCte.id })
      .from(factsCte)
      .innerJoin(c, eq(c.id, factsCte.id))
      .where(sql`${slaSql} = ${value}`);
    if (limit !== undefined) query = query.limit(limit) as typeof query;
    if (offset !== undefined) query = query.offset(offset) as typeof query;
    return (await query).map((row) => row.id);
  },
  engagement: async (db, scopeWhere, value, options, limit, offset) => {
    const { clock, rules, automaticReclaimDays } = resolveContext(options);
    const factsCte = buildSlaFactsCte(db, clock, rules, scopeWhere, false);
    const engagementSql = buildStateCoreDimensionSql(
      refsFromSlaFacts(factsCte),
      rules,
      clock,
      automaticReclaimDays,
    ).engagement;
    let query = db
      .with(factsCte)
      .select({ id: factsCte.id })
      .from(factsCte)
      .innerJoin(c, eq(c.id, factsCte.id))
      .where(sql`${engagementSql} = ${value}`);
    if (limit !== undefined) query = query.limit(limit) as typeof query;
    if (offset !== undefined) query = query.offset(offset) as typeof query;
    return (await query).map((row) => row.id);
  },
  churnLevel: async (db, scopeWhere, value, options, limit, offset) => {
    const { clock, rules, automaticReclaimDays } = resolveContext(options);
    const { slaFacts, churnCte } = buildChurnFactsCte(
      db,
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
    let query = db
      .with(slaFacts, churnCte)
      .select({ id: slaFacts.id })
      .from(slaFacts)
      .innerJoin(churnCte, eq(slaFacts.id, churnCte.id))
      .innerJoin(c, eq(c.id, slaFacts.id))
      .where(sql`${churnSql} = ${value}`);
    if (limit !== undefined) query = query.limit(limit) as typeof query;
    if (offset !== undefined) query = query.offset(offset) as typeof query;
    return (await query).map((row) => row.id);
  },
  reclamationRisk: async (db, scopeWhere, value, options, limit, offset) => {
    const { clock, rules, automaticReclaimDays } = resolveContext(options);
    const reclaimSql = buildStateCoreDimensionSql(
      refsFromReclamationRow(
        buildReclamationIdleDaysSql(clock),
        buildReclamationExemptSql(clock),
      ),
      rules,
      clock,
      automaticReclaimDays,
    ).reclamationRisk;
    let query = db
      .select({ id: c.id })
      .from(c)
      .where(and(scopeWhere, sql`${reclaimSql} = ${value}`));
    if (limit !== undefined) query = query.limit(limit) as typeof query;
    if (offset !== undefined) query = query.offset(offset) as typeof query;
    return (await query).map((row) => row.id);
  },
  attentionLevel: async (db, scopeWhere, value, options, limit, offset) => {
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
    if (offset !== undefined) ids = ids.slice(offset);
    if (limit !== undefined) ids = ids.slice(0, limit);
    return ids;
  },
};

function filterEntries(
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

async function intersectIdSets(
  db: Database,
  scopeWhere: SQL | undefined,
  filter: StateListFilter,
  options: StateDimensionQueryOptions,
): Promise<Set<string>> {
  let intersection: Set<string> | undefined;
  for (const [dimension, value] of filterEntries(filter)) {
    const ids = await FILTER_HANDLERS[dimension](
      db,
      scopeWhere,
      value,
      options,
    );
    const next = new Set(ids);
    intersection =
      intersection === undefined
        ? next
        : new Set([...intersection].filter((id) => next.has(id)));
  }
  return intersection ?? new Set();
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
    return (
      await FILTER_HANDLERS[dimension](db, baseWhere, value, options)
    ).length;
  }
  return (await intersectIdSets(db, baseWhere, filter, options)).size;
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
    if (options.limit !== undefined) query = query.limit(options.limit) as typeof query;
    if (options.offset !== undefined) query = query.offset(options.offset) as typeof query;
    return (await query).map((row) => row.id);
  }
  if (entries.length === 1) {
    const [dimension, value] = entries[0]!;
    return FILTER_HANDLERS[dimension](
      db,
      baseWhere,
      value,
      options,
      options.limit,
      options.offset,
    );
  }
  let ids = [...(await intersectIdSets(db, baseWhere, filter, options))].sort();
  if (options.offset !== undefined) ids = ids.slice(options.offset);
  if (options.limit !== undefined) ids = ids.slice(0, options.limit);
  return ids;
}

export async function queryProfileVerdicts(
  db: Database,
  scopeWhere: SQL | undefined,
  options: StateDimensionQueryOptions,
) {
  return queryProfileRows(db, scopeWhere, options);
}
