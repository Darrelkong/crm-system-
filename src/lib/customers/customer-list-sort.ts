import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const CUSTOMER_LIST_SORT_MODES = ["default", "reclaim_soonest"] as const;

export type CustomerListSortMode = (typeof CUSTOMER_LIST_SORT_MODES)[number];

export const CUSTOMER_LIST_SORT_COOKIE_NAME = "crm_customer_list_sort";

const SORT_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Parse allowlisted `sort` query param; invalid values fall back to default. */
export function parseCustomerListSortParam(
  raw: string | null | undefined,
  options?: { archived?: boolean },
): CustomerListSortMode {
  if (options?.archived) {
    return "default";
  }
  if (raw === "reclaim_soonest") {
    return "reclaim_soonest";
  }
  if (raw === "default") {
    return "default";
  }
  return "default";
}

/** Pure resolver: explicit URL sort beats remembered preference. */
export function resolveCustomerListSortMode(
  sortParam: string | undefined,
  remembered: CustomerListSortMode | null,
  options?: { archived?: boolean },
): CustomerListSortMode {
  if (options?.archived) {
    return "default";
  }
  if (sortParam != null) {
    return parseCustomerListSortParam(sortParam);
  }
  return remembered ?? "default";
}

/** Whether a bare `/customers` visit should redirect to remembered reclaim sort. */
export function shouldRedirectToRememberedSort(
  sortParam: string | undefined,
  remembered: CustomerListSortMode | null,
  archived: boolean,
): boolean {
  return (
    !archived &&
    sortParam == null &&
    remembered === "reclaim_soonest"
  );
}

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

export function getCustomerListSortCookieOptions(
  userId: string,
  sort: CustomerListSortMode,
) {
  return {
    name: CUSTOMER_LIST_SORT_COOKIE_NAME,
    value: encodeCustomerListSortPreference(userId, sort),
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: SORT_COOKIE_MAX_AGE_SECONDS,
  };
}

export async function rememberCustomerListSortPreference(
  userId: string,
  sort: CustomerListSortMode,
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(getCustomerListSortCookieOptions(userId, sort));
}

export async function readRememberedCustomerListSort(
  userId: string,
): Promise<CustomerListSortMode | null> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(CUSTOMER_LIST_SORT_COOKIE_NAME)?.value;
  return decodeCustomerListSortPreference(cookieValue, userId);
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
};

export function buildCustomersPagePath(params: CustomerListUrlParams): string {
  const search = new URLSearchParams();

  if (params.status === "archived") {
    search.set("status", "archived");
  }
  if (params.sort) {
    search.set("sort", params.sort);
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
  if (params.page && params.page !== "1") {
    search.set("page", params.page);
  }

  const query = search.toString();
  return query ? `/customers?${query}` : "/customers";
}

/**
 * URL `sort` is source of truth. When absent, redirect to remembered preference.
 * Persists explicit sort choices to a user-scoped cookie.
 */
export async function resolveCustomerListSortForPage(options: {
  userId: string;
  sortParam: string | undefined;
  archived: boolean;
  preserveParams: CustomerListUrlParams;
}): Promise<CustomerListSortMode> {
  if (options.archived) {
    return "default";
  }

  const remembered = await readRememberedCustomerListSort(options.userId);

  if (options.sortParam != null) {
    const mode = resolveCustomerListSortMode(
      options.sortParam,
      remembered,
      { archived: options.archived },
    );
    await rememberCustomerListSortPreference(options.userId, mode);
    return mode;
  }

  if (shouldRedirectToRememberedSort(options.sortParam, remembered, options.archived)) {
    redirect(
      buildCustomersPagePath({
        ...options.preserveParams,
        sort: remembered!,
      }),
    );
  }

  return resolveCustomerListSortMode(undefined, remembered, {
    archived: options.archived,
  });
}
