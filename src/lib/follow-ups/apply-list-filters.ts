import { getCustomerDisplayName } from "@/lib/customers/customer-display-name";
import { formatHongKongDate } from "@/lib/timezone";
import type { FollowUpListFilters } from "./list-filters";
import type { FollowUpListItem } from "./types";

export function applyFollowUpListItemFilters(
  items: FollowUpListItem[],
  filters: FollowUpListFilters,
  locale = "en",
): FollowUpListItem[] {
  const search = filters.search.trim().toLowerCase();

  return items.filter((item) => {
    if (search) {
      const displayName = getCustomerDisplayName({
        customerName: item.customerName,
        nameStatus: item.nameStatus,
        locale,
      }).toLowerCase();
      const rawName = item.customerName.toLowerCase();
      if (!displayName.includes(search) && !rawName.includes(search)) {
        return false;
      }
    }
    if (filters.staffUserId && item.userId !== filters.staffUserId) {
      return false;
    }
    if (filters.channel && item.channel !== filters.channel) {
      return false;
    }
    if (filters.fromDate) {
      const itemDate = formatHongKongDate(item.followUpTime, "");
      if (!itemDate || itemDate < filters.fromDate) {
        return false;
      }
    }
    if (filters.toDate) {
      const itemDate = formatHongKongDate(item.followUpTime, "");
      if (!itemDate || itemDate > filters.toDate) {
        return false;
      }
    }
    if (filters.validOnly && !item.isValidFollowUp) {
      return false;
    }
    return true;
  });
}

export function filtersForFollowUpListRole(
  filters: FollowUpListFilters,
  role: "admin" | "staff",
): FollowUpListFilters {
  if (role === "staff") {
    return { ...filters, staffUserId: "" };
  }
  return filters;
}
