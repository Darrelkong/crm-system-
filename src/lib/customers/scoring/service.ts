import { and, eq, inArray, ne } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  formatCustomerForUser,
  getCustomerAccessLevel,
  type CustomerView,
} from "@/lib/permissions/customers";
import { isArchivedCustomer } from "@/lib/customers/archived";
import { getEffectiveSettings, type EffectiveSettings } from "@/lib/settings/effective";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { User } from "../../../../drizzle/schema/users";
import {
  LOW_COMPLETENESS_THRESHOLD,
} from "./constants";
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
): CustomerWithScores[] {
  return customers.map((customer) => {
    const view = formatCustomerForUser(user, customer);
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

export async function computeScoringSummaryForAdmin(
  db: Database,
  now: Date = new Date(),
): Promise<ScoringSummary> {
  const settings = await getEffectiveSettings(db);
  const customers = await db
    .select()
    .from(schema.customers)
    .where(ne(schema.customers.status, "archived"));

  const followUpSet = await getCustomerIdsWithFollowUps(
    db,
    customers.map((c) => c.id),
  );

  return summarizeScoringForCustomers(
    customers,
    followUpSet,
    settings,
    now,
  );
}

export async function computeScoringSummaryForStaff(
  db: Database,
  user: User,
  now: Date = new Date(),
): Promise<ScoringSummary> {
  const settings = await getEffectiveSettings(db);
  const customers = await db
    .select()
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.ownerId, user.id),
        eq(schema.customers.status, "active"),
      ),
    );

  const followUpSet = await getCustomerIdsWithFollowUps(
    db,
    customers.map((c) => c.id),
  );

  return summarizeScoringForCustomers(
    customers,
    followUpSet,
    settings,
    now,
  );
}

export async function enrichCustomerResponse(
  db: Database,
  user: User,
  customer: Customer,
  now: Date = new Date(),
): Promise<CustomerWithScores> {
  const settings = await getEffectiveSettings(db);
  const followUpSet = await getCustomerIdsWithFollowUps(db, [customer.id]);
  const view = formatCustomerForUser(user, customer);
  const includeMissing = getCustomerAccessLevel(user, customer) === "full";
  const scores = getCustomerScores(
    customer,
    { hasFollowUp: followUpSet.has(customer.id) },
    settings,
    now,
    { includeMissingFields: includeMissing },
  );
  return attachScoresToView(view, scores);
}
