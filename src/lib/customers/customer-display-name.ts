import {
  isPendingNamePlaceholder,
  type CustomerNameStatus,
} from "@/lib/customers/name-status";

export type CustomerDisplayNameLocale = "zh-Hant" | "zh-Hans" | "en";

/**
 * Locale-aware display for customer names.
 * DB always stores canonical Chinese placeholders when pending.
 * Do not use for unclaimed public-pool staff views (use maskedName instead).
 */
export function getCustomerDisplayName(options: {
  customerName: string | null | undefined;
  nameStatus: CustomerNameStatus | string | null | undefined;
  locale: CustomerDisplayNameLocale | string;
}): string {
  const name = options.customerName?.trim() ?? "";
  const status =
    options.nameStatus === "pending" ? "pending" : "confirmed";

  if (status !== "pending") {
    return name;
  }

  if (!isPendingNamePlaceholder(name)) {
    return name;
  }

  const locale = options.locale;
  if (locale === "en") {
    return name === "X先生" ? "Mr. X" : "Ms. X";
  }

  return name;
}
