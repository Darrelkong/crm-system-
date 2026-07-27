import {
  getCustomerDisplayName,
  type CustomerDisplayNameLocale,
} from "@/lib/customers/customer-display-name";
import type { CustomerNameStatus } from "@/lib/customers/name-status";

export type CustomerNameLabelModelInput = {
  customerName: string | null | undefined;
  nameStatus: CustomerNameStatus | string | null | undefined;
  locale: CustomerDisplayNameLocale | string;
  /** When false, never show the pending badge (e.g. masked pool views). */
  showPendingBadge?: boolean;
};

export type CustomerNameLabelModel = {
  displayName: string;
  showPendingBadge: boolean;
};

/** Pure display model for authorized customer name + optional pending badge. */
export function resolveCustomerNameLabelModel(
  input: CustomerNameLabelModelInput,
): CustomerNameLabelModel {
  const showPendingBadge =
    input.showPendingBadge !== false && input.nameStatus === "pending";

  return {
    displayName: getCustomerDisplayName({
      customerName: input.customerName,
      nameStatus: input.nameStatus,
      locale: input.locale,
    }),
    showPendingBadge,
  };
}
