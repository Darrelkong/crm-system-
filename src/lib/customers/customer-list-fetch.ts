import type { CustomerListSortMode } from "@/lib/customers/customer-list-sort";
import {
  CUSTOMER_LIST_PAGE_SIZE,
  type CustomerListPaginationMeta,
} from "@/lib/customers/customer-list-shared";
import { buildCustomerListHref } from "@/components/ui/pagination";

export type CustomerListFetchParams = {
  page: number;
  sort: CustomerListSortMode;
  showArchived: boolean;
  filterCreatedBy?: string;
  heatFilter?: string;
  completenessBelowFilter?: string;
  filterWorkView?: string;
  filterSalesStage?: string;
  filterOwnerId?: string;
  filterReclamationRisk?: string;
};

export function buildDeferredListPagination(
  page: number,
): CustomerListPaginationMeta {
  return {
    page,
    pageSize: CUSTOMER_LIST_PAGE_SIZE,
    total: 0,
    pageCount: 1,
  };
}

export function buildCustomerListApiSearchParams(
  params: CustomerListFetchParams,
): URLSearchParams {
  const search = new URLSearchParams({
    page: String(params.page),
    sort: params.sort,
  });

  if (params.showArchived) {
    search.set("status", "archived");
  }
  if (params.filterCreatedBy) {
    search.set("createdBy", params.filterCreatedBy);
  }
  if (params.heatFilter) {
    search.set("heat", params.heatFilter);
  }
  if (params.completenessBelowFilter) {
    search.set("completenessBelow", params.completenessBelowFilter);
  }
  if (params.filterWorkView) {
    search.set("workView", params.filterWorkView);
  }
  if (params.filterSalesStage) {
    search.set("salesStage", params.filterSalesStage);
  }
  if (params.filterOwnerId) {
    search.set("ownerId", params.filterOwnerId);
  }
  if (params.filterReclamationRisk) {
    search.set("reclamationRisk", params.filterReclamationRisk);
  }

  return search;
}

export function buildCustomerListBrowserPath(
  params: CustomerListFetchParams,
): string {
  return buildCustomerListHref({
    page: params.page > 1 ? params.page : undefined,
    createdBy: params.filterCreatedBy,
    status: params.showArchived ? "archived" : undefined,
    heat: params.heatFilter,
    completenessBelow: params.completenessBelowFilter,
    sort: params.sort,
    workView: params.filterWorkView,
    salesStage: params.filterSalesStage,
    ownerId: params.filterOwnerId,
    reclamationRisk: params.filterReclamationRisk,
  });
}

export function replaceCustomerListBrowserPath(path: string): void {
  window.history.replaceState(window.history.state, "", path);
}
