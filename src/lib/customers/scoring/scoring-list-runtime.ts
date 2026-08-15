import type { Database } from "@/lib/db";
import {
  getAssigneeCustomerIdsFromRecords,
  listCustomerAssigneesByCustomerIds,
  type CustomerAssigneeRecord,
} from "@/lib/customers/assignees";
import { getCustomerIdsWithHouseholdIcon } from "@/lib/customers/households/list-indicator";
import type {
  CustomerListFilter,
  ListQueryOptions,
} from "@/lib/customers/queries";
import type { CustomerListPaginationMeta } from "@/lib/customers/customer-list-shared";
import type { EffectiveSettings } from "@/lib/settings/effective";
import type { User } from "../../../../drizzle/schema/users";
import {
  listCustomersMatchingScoringFilterPaginated,
  type RuntimeScoringListOptions,
} from "./scoring-list-sql";
import {
  recordScoringPageSupportLoads,
  recordScoringVisibleRowsScored,
} from "./scoring-sql-instrumentation";
import {
  getCustomerIdsWithFollowUps,
  getCustomersWithScores,
  type CustomerWithScores,
  type ScoringListFilter,
} from "./service";

export type ScoredCustomerListPage = {
  items: CustomerWithScores[];
  pagination: CustomerListPaginationMeta;
  assigneesByCustomerId: Map<string, CustomerAssigneeRecord[]>;
  householdIconCustomerIds: Set<string>;
};

export type LoadScoredCustomerListPageOptions = {
  settings: EffectiveSettings;
  now: Date;
  sortMode?: ListQueryOptions["sortMode"];
  automaticReclaimDays?: number;
  searchQuery?: string;
};

/**
 * Shared SSR/API scoring loader. Customer selection is page-bounded in D1;
 * all supporting reads and presentation scoring operate only on visible rows.
 */
export async function loadScoredCustomerListPage(
  db: Database,
  user: User,
  listFilter: CustomerListFilter,
  scoringFilter: ScoringListFilter,
  requestedPage: number,
  options: LoadScoredCustomerListPageOptions,
): Promise<ScoredCustomerListPage> {
  const queryOptions: RuntimeScoringListOptions = {
    settings: options.settings,
    now: options.now,
    sortMode: options.sortMode,
    automaticReclaimDays: options.automaticReclaimDays,
    searchQuery: options.searchQuery,
  };
  const result = await listCustomersMatchingScoringFilterPaginated(
    db,
    user,
    listFilter,
    scoringFilter,
    requestedPage,
    queryOptions,
  );
  const customerIds = result.items.map((customer) => customer.id);
  const [followUpSet, assigneesByCustomerId, householdIconCustomerIds] =
    await Promise.all([
      getCustomerIdsWithFollowUps(db, customerIds),
      listCustomerAssigneesByCustomerIds(db, customerIds),
      getCustomerIdsWithHouseholdIcon(db, customerIds),
    ]);
  recordScoringPageSupportLoads(customerIds.length);

  const assigneeIds = getAssigneeCustomerIdsFromRecords(
    user.id,
    customerIds,
    assigneesByCustomerId,
  );
  const items = getCustomersWithScores(
    user,
    result.items,
    followUpSet,
    options.settings,
    options.now,
    assigneeIds,
  );
  recordScoringVisibleRowsScored(items.length);

  return {
    items,
    pagination: result.pagination,
    assigneesByCustomerId,
    householdIconCustomerIds,
  };
}
