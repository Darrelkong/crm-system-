export const dynamic = "force-dynamic";

import { requireAuthCached } from "@/lib/auth/request-cache";
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
import {
  getAssigneeCustomerIdsForUser,
} from "@/lib/customers/assignees";
import { resolveReclamationRiskCustomerIds } from "@/lib/reclamation/work-items-sync";
import { parseReclamationRiskParam } from "@/lib/customers/work-view-filter";
import {
  resolveCustomerListSortForPage,
  resolveInitialServerListSortMode,
  shouldDeferCustomerListLoad,
} from "@/lib/customers/customer-list-sort";
import { buildDeferredListPagination } from "@/lib/customers/customer-list-fetch";

type Props = {
  searchParams: Promise<{
    status?: string;
    heat?: string;
    completenessBelow?: string;
    createdBy?: string;
    page?: string;
    reclamationRisk?: string;
    workView?: string;
    salesStage?: string;
    ownerId?: string;
    sort?: string;
  }>;
};

export default async function CustomersPage({ searchParams }: Props) {
  const user = await requireAuthCached();
  const params = await searchParams;
  const db = getDb();
  const reclamationScope = parseReclamationRiskParam(
    user,
    params.reclamationRisk,
  );
  const reclamationCustomerIds = await resolveReclamationRiskCustomerIds(
    db,
    user,
    reclamationScope,
  );
  const listFilter = {
    ...parseCustomerListFilter(user, {
      status: params.status,
      createdBy: params.createdBy,
      workView: params.workView,
      salesStage: params.salesStage,
      ownerId: params.ownerId,
    }),
    ...(reclamationCustomerIds !== undefined
      ? { reclamationCustomerIds }
      : {}),
  };
  const showArchived = listFilter.status === "archived";
  const settings = await getEffectiveSettings(db);
  const requestedSortMode = await resolveCustomerListSortForPage({
    userId: user.id,
    sortParam: params.sort,
    archived: showArchived,
    preserveParams: {
      status: params.status,
      createdBy: params.createdBy,
      heat: params.heat,
      completenessBelow: params.completenessBelow,
      reclamationRisk: params.reclamationRisk,
      workView: params.workView,
      salesStage: params.salesStage,
      ownerId: params.ownerId,
      page: params.page,
    },
  });
  const deferInitialListLoad = shouldDeferCustomerListLoad(requestedSortMode, {
    archived: showArchived,
  });
  const initialServerSortMode = resolveInitialServerListSortMode(
    requestedSortMode,
    { archived: showArchived },
  );
  const listQueryOptions = {
    sortMode: initialServerSortMode,
    automaticReclaimDays: settings.automaticReclaimDays,
  };
  const { page } = parseCustomerListPageParams({ page: params.page });

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

  let initialRows: Awaited<ReturnType<typeof buildCustomerListRows>> = [];
  let pagination = buildDeferredListPagination(page);

  if (!deferInitialListLoad) {
    if (hasScoringFilter) {
      const customers = await listCustomersForUser(
        user,
        listFilter,
        10_000,
        listQueryOptions,
      );
      const followUpSet = await getCustomerIdsWithFollowUps(
        db,
        customers.map((c) => c.id),
      );
      const assigneeIds = await getAssigneeCustomerIdsForUser(
        db,
        user.id,
        customers.map((customer) => customer.id),
      );
      const views = filterCustomersWithScores(
        getCustomersWithScores(
          user,
          customers,
          followUpSet,
          settings,
          new Date(),
          assigneeIds,
        ),
        scoringFilter,
      );
      pagination = buildCustomerListPagination(views.length, page);
      const offset = (pagination.page - 1) * pagination.pageSize;
      const pageViews = views.slice(offset, offset + pagination.pageSize);
      initialRows = await buildCustomerListRows(db, pageViews);
    } else {
      const result = await listCustomersForUserPaginated(
        user,
        listFilter,
        page,
        listQueryOptions,
      );
      const followUpSet = await getCustomerIdsWithFollowUps(
        db,
        result.items.map((c) => c.id),
      );
      const assigneeIds = await getAssigneeCustomerIdsForUser(
        db,
        user.id,
        result.items.map((customer) => customer.id),
      );
      const views = getCustomersWithScores(
        user,
        result.items,
        followUpSet,
        settings,
        new Date(),
        assigneeIds,
      );
      initialRows = await buildCustomerListRows(db, views);
      pagination = result.pagination;
    }
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
      sortMode={requestedSortMode}
      deferInitialListLoad={deferInitialListLoad}
      initialPage={page}
      filterWorkView={params.workView}
      filterSalesStage={params.salesStage}
      filterOwnerId={params.ownerId}
      filterReclamationRisk={params.reclamationRisk}
    />
  );
}
