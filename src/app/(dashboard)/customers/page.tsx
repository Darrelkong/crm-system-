export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/permissions/auth";
import {
  listCustomerCreatorsForAdmin,
  listCustomersForUser,
  listCustomersForUserPaginated,
  parseCustomerListFilter,
  parseCustomerListPageParams,
  buildCustomerListPagination,
} from "@/lib/customers/queries";
import {
  filterCustomersWithScores,
  getCustomerIdsWithFollowUps,
  getCustomersWithScores,
} from "@/lib/customers/scoring/service";
import { HEAT_LEVELS } from "@/lib/customers/scoring/types";
import { getEffectiveSettings } from "@/lib/settings/effective";
import { getDb } from "@/lib/db";
import type { HeatLevel } from "@/lib/customers/scoring/types";
import { CustomersListClient } from "./customers-list-client";
import { buildCustomerListRows } from "@/lib/customers/list-rows";

type Props = {
  searchParams: Promise<{
    status?: string;
    heat?: string;
    completenessBelow?: string;
    createdBy?: string;
    page?: string;
  }>;
};

export default async function CustomersPage({ searchParams }: Props) {
  const user = await requireAuth();
  const params = await searchParams;
  const listFilter = parseCustomerListFilter(user, params);
  const showArchived = listFilter.status === "archived";
  const { page } = parseCustomerListPageParams({ page: params.page });

  const db = getDb();
  const settings = await getEffectiveSettings(db);

  const scoringFilter: {
    heat?: HeatLevel;
    completenessBelow?: number;
  } = {};
  if (params.heat && (HEAT_LEVELS as readonly string[]).includes(params.heat)) {
    scoringFilter.heat = params.heat as HeatLevel;
  }
  if (params.completenessBelow) {
    const n = Number(params.completenessBelow);
    if (Number.isFinite(n)) scoringFilter.completenessBelow = n;
  }

  const hasScoringFilter =
    scoringFilter.heat != null || scoringFilter.completenessBelow != null;

  let initialRows;
  let pagination;

  if (hasScoringFilter) {
    const customers = await listCustomersForUser(user, listFilter);
    const followUpSet = await getCustomerIdsWithFollowUps(
      db,
      customers.map((c) => c.id),
    );
    const views = filterCustomersWithScores(
      getCustomersWithScores(user, customers, followUpSet, settings),
      scoringFilter,
    );
    pagination = buildCustomerListPagination(views.length, page);
    const offset = (pagination.page - 1) * pagination.pageSize;
    const pageViews = views.slice(offset, offset + pagination.pageSize);
    initialRows = await buildCustomerListRows(db, pageViews);
  } else {
    const result = await listCustomersForUserPaginated(user, listFilter, page);
    const followUpSet = await getCustomerIdsWithFollowUps(
      db,
      result.items.map((c) => c.id),
    );
    const views = getCustomersWithScores(
      user,
      result.items,
      followUpSet,
      settings,
    );
    initialRows = await buildCustomerListRows(db, views);
    pagination = result.pagination;
  }

  const creatorOptions =
    user.role === "admin"
      ? await listCustomerCreatorsForAdmin(
          showArchived ? { status: "archived" } : {},
        )
      : [];

  return (
    <CustomersListClient
      initialRows={initialRows}
      pagination={pagination}
      showArchived={showArchived}
      isAdmin={user.role === "admin"}
      filterCreatedBy={listFilter.createdBy}
      creatorOptions={creatorOptions}
      heatFilter={scoringFilter.heat}
      completenessBelowFilter={
        scoringFilter.completenessBelow != null
          ? String(scoringFilter.completenessBelow)
          : undefined
      }
    />
  );
}
