/**
 * Client URL state for /follow-ups list filters.
 * Filter semantics match FollowUpsListClient.applyFilters — do not invent fields.
 */

export type FollowUpListFilters = {
  search: string;
  staffUserId: string;
  channel: string;
  fromDate: string;
  toDate: string;
};

export const DEFAULT_FOLLOW_UP_LIST_FILTERS: FollowUpListFilters = {
  search: "",
  staffUserId: "",
  channel: "",
  fromDate: "",
  toDate: "",
};

/** Stable URL query keys for this page only. */
export const FOLLOW_UP_LIST_FILTER_KEYS = [
  "q",
  "channel",
  "from",
  "to",
  "staff",
] as const;

export type FollowUpListFilterKey = (typeof FOLLOW_UP_LIST_FILTER_KEYS)[number];

export const FOLLOW_UP_LIST_SEARCH_MAX_LENGTH = 100;
export const FOLLOW_UP_LIST_CHANNEL_MAX_LENGTH = 32;
export const FOLLOW_UP_LIST_STAFF_ID_MAX_LENGTH = 64;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CHANNEL_RE = /^[a-z0-9_]+$/i;
const STAFF_ID_RE = /^[a-zA-Z0-9_-]+$/;

function isValidIsoDateOnly(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function normalizeFollowUpListSearch(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim().slice(0, FOLLOW_UP_LIST_SEARCH_MAX_LENGTH);
  return trimmed;
}

export function normalizeFollowUpListChannel(
  raw: string | null | undefined,
): string {
  const trimmed = (raw ?? "").trim().slice(0, FOLLOW_UP_LIST_CHANNEL_MAX_LENGTH);
  if (!trimmed || !CHANNEL_RE.test(trimmed)) return "";
  return trimmed;
}

export function normalizeFollowUpListStaffId(
  raw: string | null | undefined,
): string {
  const trimmed = (raw ?? "").trim().slice(0, FOLLOW_UP_LIST_STAFF_ID_MAX_LENGTH);
  if (!trimmed || !STAFF_ID_RE.test(trimmed)) return "";
  return trimmed;
}

export function normalizeFollowUpListDate(
  raw: string | null | undefined,
): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || !isValidIsoDateOnly(trimmed)) return "";
  return trimmed;
}

export function parseFollowUpListFilters(
  params: URLSearchParams,
): FollowUpListFilters {
  return {
    search: normalizeFollowUpListSearch(params.get("q")),
    channel: normalizeFollowUpListChannel(params.get("channel")),
    fromDate: normalizeFollowUpListDate(params.get("from")),
    toDate: normalizeFollowUpListDate(params.get("to")),
    staffUserId: normalizeFollowUpListStaffId(params.get("staff")),
  };
}

export function hasActiveFollowUpListFilters(
  filters: FollowUpListFilters,
): boolean {
  return countActiveFollowUpListFilters(filters) > 0;
}

/** Count non-empty filter fields; same fields as hasActiveFollowUpListFilters. */
export function countActiveFollowUpListFilters(
  filters: FollowUpListFilters,
): number {
  let count = 0;
  if (filters.search) count += 1;
  if (filters.channel) count += 1;
  if (filters.fromDate) count += 1;
  if (filters.toDate) count += 1;
  if (filters.staffUserId) count += 1;
  return count;
}

/** Remove only known follow-ups filter keys; preserve unrelated params. */
export function clearFollowUpListFilterParams(
  params: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  for (const key of FOLLOW_UP_LIST_FILTER_KEYS) {
    next.delete(key);
  }
  return next;
}

/**
 * Write active filters onto a copy of existing params.
 * Default / empty values are omitted from the URL.
 */
export function applyFollowUpListFiltersToSearchParams(
  filters: FollowUpListFilters,
  existing: URLSearchParams,
): URLSearchParams {
  const next = clearFollowUpListFilterParams(existing);
  const search = normalizeFollowUpListSearch(filters.search);
  const channel = normalizeFollowUpListChannel(filters.channel);
  const fromDate = normalizeFollowUpListDate(filters.fromDate);
  const toDate = normalizeFollowUpListDate(filters.toDate);
  const staffUserId = normalizeFollowUpListStaffId(filters.staffUserId);

  if (search) next.set("q", search);
  if (channel) next.set("channel", channel);
  if (fromDate) next.set("from", fromDate);
  if (toDate) next.set("to", toDate);
  if (staffUserId) next.set("staff", staffUserId);

  return next;
}

export function followUpListFiltersEqual(
  a: FollowUpListFilters,
  b: FollowUpListFilters,
): boolean {
  return (
    a.search === b.search &&
    a.channel === b.channel &&
    a.fromDate === b.fromDate &&
    a.toDate === b.toDate &&
    a.staffUserId === b.staffUserId
  );
}

/** Build pathname + search for history API without navigating. */
export function buildFollowUpListHref(
  pathname: string,
  filters: FollowUpListFilters,
  existingSearch: string,
): string {
  const existing = new URLSearchParams(
    existingSearch.startsWith("?") ? existingSearch.slice(1) : existingSearch,
  );
  const next = applyFollowUpListFiltersToSearchParams(filters, existing);
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
