export const CUSTOMER_LIST_SORT_MODES = ["default", "reclaim_soonest"] as const;

export type CustomerListSortMode = (typeof CUSTOMER_LIST_SORT_MODES)[number];

export const CUSTOMER_LIST_SORT_COOKIE_NAME = "crm_customer_list_sort";

/** Customer list pages always use default sort; legacy sort params are stripped. */
export const CUSTOMER_LIST_ACTIVE_SORT_MODE: CustomerListSortMode = "default";

/** Parse list sort for API/page queries — always default for normal customer list. */
export function parseCustomerListSortParam(
  raw?: string | null,
  options?: { archived?: boolean },
): CustomerListSortMode {
  void raw;
  void options;
  return CUSTOMER_LIST_ACTIVE_SORT_MODE;
}

/** Legacy cookie decode (tests / migration only); customer list ignores remembered sort. */
export function encodeCustomerListSortPreference(
  userId: string,
  sort: CustomerListSortMode,
): string {
  return `${userId}:${sort}`;
}

export function decodeCustomerListSortPreference(
  cookieValue: string | undefined,
  userId: string,
): CustomerListSortMode | null {
  if (!cookieValue) {
    return null;
  }
  const separator = cookieValue.indexOf(":");
  if (separator <= 0) {
    return null;
  }
  const cookieUserId = cookieValue.slice(0, separator);
  const sort = cookieValue.slice(separator + 1);
  if (cookieUserId !== userId) {
    return null;
  }
  if (sort === "reclaim_soonest" || sort === "default") {
    return sort;
  }
  return null;
}

export type CustomerListUrlParams = {
  status?: string;
  sort?: string;
  createdBy?: string;
  heat?: string;
  completenessBelow?: string;
  page?: string;
  reclamationRisk?: string;
  workView?: string;
  salesStage?: string;
  ownerId?: string;
  relationship?: string;
};

/** Build `/customers` path; never emits legacy `sort` query params. */
export function buildCustomersPagePath(params: CustomerListUrlParams): string {
  const search = new URLSearchParams();

  if (params.status === "archived") {
    search.set("status", "archived");
  }
  if (params.createdBy) {
    search.set("createdBy", params.createdBy);
  }
  if (params.heat) {
    search.set("heat", params.heat);
  }
  if (params.completenessBelow) {
    search.set("completenessBelow", params.completenessBelow);
  }
  if (params.reclamationRisk) {
    search.set("reclamationRisk", params.reclamationRisk);
  }
  if (params.workView) {
    search.set("workView", params.workView);
  }
  if (params.salesStage) {
    search.set("salesStage", params.salesStage);
  }
  if (params.ownerId) {
    search.set("ownerId", params.ownerId);
  }
  if (params.relationship) {
    search.set("relationship", params.relationship);
  }
  if (params.page && params.page !== "1") {
    search.set("page", params.page);
  }

  const query = search.toString();
  return query ? `/customers?${query}` : "/customers";
}

/** Whether a legacy `sort` query param should be stripped via redirect. */
export function shouldStripCustomerListSortParam(
  sortParam: string | undefined,
): boolean {
  return sortParam != null;
}
