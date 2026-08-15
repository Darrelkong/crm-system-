import {
  buildCustomerListPagination,
  CUSTOMER_LIST_PAGE_SIZE,
} from "@/lib/customers/queries";
import { compareCustomersForList } from "@/lib/customers/list-sort";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { EffectiveSettings } from "@/lib/settings/effective";
import { calculateDataCompletenessScore } from "./completeness";
import { calculateCustomerHeat } from "./heat";
import type { ScoringListFilter } from "./service";

export type ScoringFilterMatch = {
  id: string;
  heatLevel: ReturnType<typeof calculateCustomerHeat>["heatLevel"];
  completenessScore: number;
};

/** Reference OLD path: score in JS then filter (authoritative for parity tests). */
export function scoreCustomersForFilterReference(
  customers: Customer[],
  followUpSet: Set<string>,
  settings: EffectiveSettings,
  now: Date = new Date(),
): ScoringFilterMatch[] {
  return customers.map((customer) => {
    const heat = calculateCustomerHeat(customer, settings, now);
    const { completenessScore } = calculateDataCompletenessScore(
      customer,
      followUpSet.has(customer.id),
    );
    return {
      id: customer.id,
      heatLevel: heat.heatLevel,
      completenessScore,
    };
  });
}

export function filterScoredCustomerIdsReference(
  scored: ScoringFilterMatch[],
  filter: ScoringListFilter,
): string[] {
  let result = scored;
  if (filter.heat) {
    result = result.filter((item) => item.heatLevel === filter.heat);
  }
  if (filter.completenessBelow !== undefined) {
    result = result.filter(
      (item) => item.completenessScore < filter.completenessBelow!,
    );
  }
  return result.map((item) => item.id);
}

export function orderCustomersForListReference(
  customers: Customer[],
  now: Date = new Date(),
): Customer[] {
  return [...customers].sort((a, b) => compareCustomersForList(a, b, now));
}

export function paginateCustomerIdsReference(
  orderedCustomers: Customer[],
  matchingIds: Set<string>,
  page: number,
  pageSize: number = CUSTOMER_LIST_PAGE_SIZE,
): {
  pageIds: string[];
  total: number;
  pagination: ReturnType<typeof buildCustomerListPagination>;
} {
  const filtered = orderedCustomers.filter((customer) =>
    matchingIds.has(customer.id),
  );
  const pagination = buildCustomerListPagination(filtered.length, page);
  const offset = (pagination.page - 1) * pagination.pageSize;
  const pageIds = filtered
    .slice(offset, offset + pagination.pageSize)
    .map((customer) => customer.id);

  return {
    pageIds,
    total: filtered.length,
    pagination,
  };
}

export type LegacyScoringPathStats = {
  customersHydrated: number;
  followUpIdsConsidered: number;
  assigneeIdsConsidered: number;
  customersScoredInJs: number;
};

export function measureLegacyScoringPath(
  customers: Customer[],
  followUpSet: Set<string>,
  settings: EffectiveSettings,
  filter: ScoringListFilter,
  now: Date = new Date(),
): {
  matchingIds: string[];
  stats: LegacyScoringPathStats;
} {
  const scored = scoreCustomersForFilterReference(
    customers,
    followUpSet,
    settings,
    now,
  );
  return {
    matchingIds: filterScoredCustomerIdsReference(scored, filter),
    stats: {
      customersHydrated: customers.length,
      followUpIdsConsidered: customers.length,
      assigneeIdsConsidered: customers.length,
      customersScoredInJs: scored.length,
    },
  };
}
