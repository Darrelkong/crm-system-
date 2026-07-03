import { and, eq, inArray, ne, type SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  formatCustomerForUser,
  getCustomerAccessLevel,
  resolveCustomerAccessOptions,
  type CustomerAccessOptions,
  type CustomerView,
} from "@/lib/permissions/customers";
import { isArchivedCustomer } from "@/lib/customers/archived";
import {
  getEffectiveSettings,
  type EffectiveSettings,
} from "@/lib/settings/effective";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { User } from "../../../../drizzle/schema/users";
import { LOW_COMPLETENESS_THRESHOLD } from "./constants";
import type { HeatLevel } from "./types";
import { HEAT_LEVELS } from "./types";
import { calculateDataCompletenessScore } from "./completeness";
import { calculateCustomerHeat } from "./heat";
import type { CustomerScores, ScoringContext } from "./types";

export type CustomerWithScores = CustomerView & CustomerScores;

export type ScoringListFilter = {
  heat?: HeatLevel;
  completenessBelow?: number;
};

export async function getCustomerIdsWithFollowUps(
  db: Database,
  customerIds: string[],
): Promise<Set<string>> {
  if (customerIds.length === 0) {
    return new Set();
  }
  const rows = await db
    .selectDistinct({ customerId: schema.followUps.customerId })
    .from(schema.followUps)
    .where(inArray(schema.followUps.customerId, customerIds));
  return new Set(rows.map((r) => r.customerId));
}

export function getCustomerScores(
  customer: Customer,
  context: ScoringContext,
  settings: EffectiveSettings,
  now: Date = new Date(),
  options?: { includeMissingFields?: boolean },
): CustomerScores {
  const heat = calculateCustomerHeat(customer, settings, now);
  const completeness = calculateDataCompletenessScore(
    customer,
    context.hasFollowUp,
  );

  const scores: CustomerScores = {
    heatLevel: heat.heatLevel,
    completenessScore: completeness.completenessScore,
    heatReasonKeys: heat.heatReasonKeys,
  };

  if (options?.includeMissingFields) {
    scores.completenessMissingFields = completeness.completenessMissingFields;
  }

  return scores;
}

export function attachScoresToView(
  view: CustomerView,
  scores: CustomerScores,
): CustomerWithScores {
  const includeDetails = view.accessLevel === "full";
  return {
    ...view,
    heatLevel: scores.heatLevel,
    completenessScore: scores.completenessScore,
    heatReasonKeys: includeDetails ? scores.heatReasonKeys : undefined,
    completenessMissingFields: includeDetails
      ? scores.completenessMissingFields
      : undefined,
  };
}

export function getCustomersWithScores(
  user: User,
  customers: Customer[],
  followUpSet: Set<string>,
  settings: EffectiveSettings,
  now: Date = new Date(),
  assigneeCustomerIds: Set<string> = new Set(),
): CustomerWithScores[] {
  return customers.map((customer) => {
    const accessOptions: CustomerAccessOptions = assigneeCustomerIds.has(
      customer.id,
    )
      ? { isAssignee: true }
      : {};
    const view = formatCustomerForUser(user, customer, accessOptions);
    const includeMissing = view.accessLevel === "full";
    const scores = getCustomerScores(
      customer,
      { hasFollowUp: followUpSet.has(customer.id) },
      settings,
      now,
      { includeMissingFields: includeMissing },
    );
    return attachScoresToView(view, scores);
  });
}

export function filterCustomersWithScores(
  items: CustomerWithScores[],
  filter: ScoringListFilter,
): CustomerWithScores[] {
  let result = items;
  if (filter.heat) {
    result = result.filter((item) => item.heatLevel === filter.heat);
  }
  if (filter.completenessBelow !== undefined) {
    result = result.filter(
      (item) => item.completenessScore < filter.completenessBelow!,
    );
  }
  return result;
}

export function parseScoringListFilter(
  searchParams: URLSearchParams,
): ScoringListFilter {
  const filter: ScoringListFilter = {};
  const heat = searchParams.get("heat");
  if (heat && (HEAT_LEVELS as readonly string[]).includes(heat)) {
    filter.heat = heat as HeatLevel;
  }
  const below = searchParams.get("completenessBelow");
  if (below) {
    const n = Number(below);
    if (Number.isFinite(n) && n >= 0 && n <= 100) {
      filter.completenessBelow = n;
    }
  }
  return filter;
}

export type ScoringSummary = {
  highChurnRiskCustomers: number;
  lowCompletenessCustomers: number;
};

export function summarizeScoringForCustomers(
  customers: Customer[],
  followUpSet: Set<string>,
  settings: EffectiveSettings,
  now: Date = new Date(),
  options: { countArchivedInLowCompleteness?: boolean } = {},
): ScoringSummary {
  let highChurnRiskCustomers = 0;
  let lowCompletenessCustomers = 0;

  for (const customer of customers) {
    if (isArchivedCustomer(customer)) {
      if (!options.countArchivedInLowCompleteness) {
        continue;
      }
    }

    const heat = calculateCustomerHeat(customer, settings, now);
    const { completenessScore } = calculateDataCompletenessScore(
      customer,
      followUpSet.has(customer.id),
    );

    if (heat.heatLevel === "high_churn_risk") {
      highChurnRiskCustomers += 1;
    }
    if (completenessScore < LOW_COMPLETENESS_THRESHOLD) {
      lowCompletenessCustomers += 1;
    }
  }

  return { highChurnRiskCustomers, lowCompletenessCustomers };
}

/**
 * Count customers matching `baseFilter` whose heat level is `high_churn_risk`.
 *
 * Replicates `calculateCustomerHeat` → `high_churn_risk` condition in SQL:
 *   days_without_valid >= warningThreshold
 *   OR next_follow_up_at is overdue
 *   OR days_without_valid >= max(1, automaticReclaimDays - 1)
 *
 * Note on trim(): SQLite trim() removes ASCII space (0x20) only; JS String.trim()
 * removes all Unicode whitespace. Whitespace-only field values are not expected in
 * production data (the app validates and trims on save).
 */
async function countHighChurnRiskSql(
  db: Database,
  baseFilter: SQL | undefined,
  settings: EffectiveSettings,
  nowIso: string,
): Promise<number> {
  const warningThreshold = settings.reclaimWarningThresholdDays;
  const nearReclaimThreshold = Math.max(1, settings.automaticReclaimDays - 1);

  const rows = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(schema.customers)
    .where(
      and(
        baseFilter,
        sql`(
          CAST((julianday(${nowIso}) - julianday(COALESCE(last_valid_follow_up_at, created_at))) AS INTEGER) >= ${warningThreshold}
          OR (next_follow_up_at IS NOT NULL AND next_follow_up_at < ${nowIso})
          OR CAST((julianday(${nowIso}) - julianday(COALESCE(last_valid_follow_up_at, created_at))) AS INTEGER) >= ${nearReclaimThreshold}
        )`,
      ),
    );
  return Number(rows[0]?.cnt ?? 0);
}

/**
 * Count customers matching `baseFilter` whose data completeness score is below
 * LOW_COMPLETENESS_THRESHOLD. Replicates `calculateDataCompletenessScore` in SQL.
 *
 * Score breakdown (max 100):
 *   customerName: 10 | phone OR wechatId: 20 | email: 10 | source: 10
 *   salesStage: 10 | ownerId: 10 | notes: 10 | hasFollowUp (EXISTS): 10
 *   nextFollowUpAt: 10
 */
async function countLowCompletenessSql(
  db: Database,
  baseFilter: SQL | undefined,
): Promise<number> {
  const rows = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(schema.customers)
    .where(
      and(
        baseFilter,
        sql`(
          (CASE WHEN customer_name IS NOT NULL AND trim(customer_name) != '' THEN 10 ELSE 0 END)
          + (CASE WHEN (phone IS NOT NULL AND trim(phone) != '') OR (wechat_id IS NOT NULL AND trim(wechat_id) != '') THEN 20 ELSE 0 END)
          + (CASE WHEN email IS NOT NULL AND trim(email) != '' THEN 10 ELSE 0 END)
          + (CASE WHEN source IS NOT NULL AND trim(source) != '' THEN 10 ELSE 0 END)
          + (CASE WHEN sales_stage IS NOT NULL AND trim(sales_stage) != '' THEN 10 ELSE 0 END)
          + (CASE WHEN owner_id IS NOT NULL AND trim(owner_id) != '' THEN 10 ELSE 0 END)
          + (CASE WHEN notes IS NOT NULL AND trim(notes) != '' THEN 10 ELSE 0 END)
          + (CASE WHEN EXISTS (SELECT 1 FROM follow_ups WHERE follow_ups.customer_id = ${schema.customers.id}) THEN 10 ELSE 0 END)
          + (CASE WHEN next_follow_up_at IS NOT NULL AND trim(next_follow_up_at) != '' THEN 10 ELSE 0 END)
        ) < ${LOW_COMPLETENESS_THRESHOLD}`,
      ),
    );
  return Number(rows[0]?.cnt ?? 0);
}

/**
 * Compute highChurnRiskCustomers and lowCompletenessCustomers for the admin
 * dashboard. Uses SQL aggregate COUNT queries instead of loading all customer
 * rows into memory.
 *
 * @param preloadedSettings - Pass the already-fetched EffectiveSettings to
 *   avoid a duplicate DB round-trip when called from getAdminDashboardStats.
 */
export async function computeScoringSummaryForAdmin(
  db: Database,
  now: Date = new Date(),
  preloadedSettings?: EffectiveSettings,
): Promise<ScoringSummary> {
  const settings = preloadedSettings ?? (await getEffectiveSettings(db));
  const nowIso = now.toISOString();
  const baseFilter = ne(schema.customers.status, "archived");

  const [highChurnRiskCustomers, lowCompletenessCustomers] = await Promise.all([
    countHighChurnRiskSql(db, baseFilter, settings, nowIso),
    countLowCompletenessSql(db, baseFilter),
  ]);

  return { highChurnRiskCustomers, lowCompletenessCustomers };
}

/**
 * Compute highChurnRiskCustomers and lowCompletenessCustomers for the staff
 * dashboard. Restricted to customers owned by `user` with status = 'active'.
 *
 * @param preloadedSettings - Pass the already-fetched EffectiveSettings to
 *   avoid a duplicate DB round-trip when called from getStaffDashboardStats.
 */
export async function computeScoringSummaryForStaff(
  db: Database,
  user: User,
  now: Date = new Date(),
  preloadedSettings?: EffectiveSettings,
): Promise<ScoringSummary> {
  const settings = preloadedSettings ?? (await getEffectiveSettings(db));
  const nowIso = now.toISOString();
  const baseFilter = and(
    eq(schema.customers.ownerId, user.id),
    eq(schema.customers.status, "active"),
  );

  const [highChurnRiskCustomers, lowCompletenessCustomers] = await Promise.all([
    countHighChurnRiskSql(db, baseFilter, settings, nowIso),
    countLowCompletenessSql(db, baseFilter),
  ]);

  return { highChurnRiskCustomers, lowCompletenessCustomers };
}

export async function enrichCustomerResponse(
  db: Database,
  user: User,
  customer: Customer,
  now: Date = new Date(),
  accessOptions?: CustomerAccessOptions,
): Promise<CustomerWithScores> {
  const settings = await getEffectiveSettings(db);
  const followUpSet = await getCustomerIdsWithFollowUps(db, [customer.id]);
  const resolvedOptions =
    accessOptions ??
    (user.role === "staff"
      ? await resolveCustomerAccessOptions(db, user, customer.id)
      : {});
  const view = formatCustomerForUser(user, customer, resolvedOptions);
  const includeMissing =
    getCustomerAccessLevel(user, customer, resolvedOptions) === "full";
  const scores = getCustomerScores(
    customer,
    { hasFollowUp: followUpSet.has(customer.id) },
    settings,
    now,
    { includeMissingFields: includeMissing },
  );
  return attachScoresToView(view, scores);
}
