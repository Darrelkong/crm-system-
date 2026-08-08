import {
  DEFAULT_FOLLOW_UP_LIST_FILTERS,
  applyFollowUpListFiltersToSearchParams,
  type FollowUpListFilters,
} from "@/lib/follow-ups/list-filters";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";
import { getBusinessDateYmd } from "./dates";
import {
  getHongKongSeriesUtcBounds,
  type TrendRangeDays,
} from "./dashboard-trends-period";

function buildFollowUpListPath(filters: FollowUpListFilters): string {
  const params = applyFollowUpListFiltersToSearchParams(
    filters,
    new URLSearchParams(),
  );
  const qs = params.toString();
  return qs ? `/follow-ups?${qs}` : "/follow-ups";
}

/** HK calendar YMD for dashboard drill-down links. */
export function getDashboardHongKongTodayYmd(now: Date = new Date()): string {
  return getBusinessDateYmd(now, HONG_KONG_TIMEZONE);
}

/** Today + valid follow-ups only; optional staff scope for admin team drill-down. */
export function buildValidFollowUpsTodayHref(
  now: Date = new Date(),
  options?: { staffUserId?: string },
): string {
  const today = getDashboardHongKongTodayYmd(now);
  return buildFollowUpListPath({
    ...DEFAULT_FOLLOW_UP_LIST_FILTERS,
    fromDate: today,
    toDate: today,
    validOnly: true,
    staffUserId: options?.staffUserId ?? "",
  });
}

/** Staff + HK period + valid follow-ups for team execution drill-down. */
export function buildTeamValidFollowUpsHref(
  staffUserId: string,
  periodDays: TrendRangeDays,
  now: Date = new Date(),
): string {
  const { dates } = getHongKongSeriesUtcBounds(now, periodDays);
  const fromDate = dates[0]!;
  const toDate = dates[dates.length - 1]!;
  return buildFollowUpListPath({
    ...DEFAULT_FOLLOW_UP_LIST_FILTERS,
    fromDate,
    toDate,
    validOnly: true,
    staffUserId,
  });
}

/** Member-scoped 7-day auto-release risk customers (admin team drill-down). */
export function buildTeamReclamationHref(ownerId: string): string {
  const params = new URLSearchParams();
  params.set("ownerId", ownerId);
  params.set("reclamationRisk", "team");
  return `/customers?${params.toString()}`;
}
