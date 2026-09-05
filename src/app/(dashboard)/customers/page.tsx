export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { requireAuthCached } from "@/lib/auth/request-cache";
import {
  listCustomerCreatorsForAdmin,
  listCustomersForUserPaginated,
  parseCustomerListFilter,
  parseCustomerListPageParams,
} from "@/lib/customers/queries";
import {
  getCustomerIdsWithFollowUps,
  getCustomersWithScores,
} from "@/lib/customers/scoring/service";
import { loadScoredCustomerListPage } from "@/lib/customers/scoring/scoring-list-runtime";
import { HEAT_LEVELS } from "@/lib/customers/scoring/types";
import { getEffectiveSettings } from "@/lib/settings/effective";
import { getDb } from "@/lib/db";
import type { HeatLevel } from "@/lib/customers/scoring/types";
import { CustomersListClient } from "./customers-list-client";
import { buildCustomerListRows } from "@/lib/customers/list-rows";
import {
  getAssigneeCustomerIdsFromRecords,
  listCustomerAssigneesByCustomerIds,
} from "@/lib/customers/assignees";
import { getCustomerIdsWithHouseholdIcon } from "@/lib/customers/households/list-indicator";
import { resolveReclamationRiskCustomerIds } from "@/lib/reclamation/work-items-sync";
import { parseReclamationRiskParam } from "@/lib/customers/work-view-filter";
import {
  buildCustomersPagePath,
  CUSTOMER_LIST_ACTIVE_SORT_MODE,
  shouldStripCustomerListSortParam,
} from "@/lib/customers/customer-list-sort";
import { shouldEnableCustomerNavigationPerf } from "@/lib/customers/customer-navigation-perf";

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
    perf?: string;
    relationship?: string;
  }>;
};

export default async function CustomersPage({ searchParams }: Props) {
  const user = await requireAuthCached();
  const params = await searchParams;

  if (shouldStripCustomerListSortParam(params.sort)) {
    redirect(
      buildCustomersPagePath({
        status: params.status,
        createdBy: params.createdBy,
        heat: params.heat,
        completenessBelow: params.completenessBelow,
        reclamationRisk: params.reclamationRisk,
        workView: params.workView,
        salesStage: params.salesStage,
        ownerId: params.ownerId,
        relationship: params.relationship,
        page: params.page,
      }),
    );
  }

  const db = getDb();
  const reclamationScope = parseReclamationRiskParam(
    user,
    params.reclamationRisk,
  );

  const [reclamationCustomerIds, settings] = await Promise.all([
    resolveReclamationRiskCustomerIds(db, user, reclamationScope),
    getEffectiveSettings(db),
  ]);

  const listFilter = {
    ...parseCustomerListFilter(user, {
      status: params.status,
      createdBy: params.createdBy,
      workView: params.workView,
      salesStage: params.salesStage,
      ownerId: params.ownerId,
    }),
    ...(reclamationCustomerIds !== undefined ? { reclamationCustomerIds } : {}),
  };
  const showArchived = listFilter.status === "archived";
  const listQueryOptions = {
    sortMode: CUSTOMER_LIST_ACTIVE_SORT_MODE,
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

  const creatorOptionsPromise =
    user.role === "admin"
      ? listCustomerCreatorsForAdmin(showArchived ? { status: "archived" } : {})
      : Promise.resolve([]);

  let initialRows: Awaited<ReturnType<typeof buildCustomerListRows>> = [];
  let pagination;
  let creatorOptions: Awaited<typeof creatorOptionsPromise> = [];

  if (hasScoringFilter) {
    const scoringNow = new Date();
    const [result, resolvedCreatorOptions] = await Promise.all([
      loadScoredCustomerListPage(db, user, listFilter, scoringFilter, page, {
        settings,
        now: scoringNow,
        ...listQueryOptions,
      }),
      creatorOptionsPromise,
    ]);
    creatorOptions = resolvedCreatorOptions;

    initialRows = await buildCustomerListRows(db, result.items, {
      assigneesByCustomerId: result.assigneesByCustomerId,
      householdIconCustomerIds: result.householdIconCustomerIds,
      viewer: user,
    });
    pagination = result.pagination;
  } else {
    const [result, resolvedCreatorOptions] = await Promise.all([
      listCustomersForUserPaginated(user, listFilter, page, listQueryOptions),
      creatorOptionsPromise,
    ]);
    creatorOptions = resolvedCreatorOptions;

    const customerIds = result.items.map((customer) => customer.id);
    const [followUpSet, assigneesByCustomerId, householdIconCustomerIds] =
      await Promise.all([
        getCustomerIdsWithFollowUps(db, customerIds),
        listCustomerAssigneesByCustomerIds(db, customerIds),
        getCustomerIdsWithHouseholdIcon(db, customerIds),
      ]);
    const assigneeIds = getAssigneeCustomerIdsFromRecords(
      user.id,
      customerIds,
      assigneesByCustomerId,
    );
    const views = getCustomersWithScores(
      user,
      result.items,
      followUpSet,
      settings,
      new Date(),
      assigneeIds,
    );
    initialRows = await buildCustomerListRows(db, views, {
      assigneesByCustomerId,
      householdIconCustomerIds,
      viewer: user,
    });
    pagination = result.pagination;
  }

  const enableNavigationPerf = shouldEnableCustomerNavigationPerf(
    user.role,
    params.perf,
  );

  return (
    <CustomersListClient
      initialRows={initialRows}
      pagination={pagination}
      showArchived={showArchived}
      isAdmin={user.role === "admin"}
      enableNavigationPerf={enableNavigationPerf}
      filterCreatedBy={listFilter.createdBy}
      creatorOptions={creatorOptions}
      heatFilter={scoringFilter.heat}
      completenessBelowFilter={
        scoringFilter.completenessBelow != null
          ? String(scoringFilter.completenessBelow)
          : undefined
      }
      filterWorkView={params.workView}
      filterSalesStage={params.salesStage}
      filterOwnerId={params.ownerId}
      filterRelationship={
        params.relationship === "owner" ||
        params.relationship === "collaborator"
          ? params.relationship
          : undefined
      }
      filterReclamationRisk={params.reclamationRisk}
    />
  );
}
