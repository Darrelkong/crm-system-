import { getCustomerDisplayName } from "@/lib/customers/customer-display-name";

export type CustomerNotificationNameInput = {
  customerName: string | null | undefined;
  /** When missing/invalid, keep legacy raw-name rendering (no pending suffix). */
  nameStatus?: string | null | undefined;
  locale: string;
  /** Already-translated `customers.namePendingBadge`. */
  pendingLabel: string;
};

/**
 * Localized customer name for notification message interpolation.
 * Confirmed / legacy (no nameStatus): bare display name.
 * Pending: "X先生（姓名待確認）" / "Mr. X (Name pending confirmation)".
 */
export function getCustomerNotificationDisplayName(
  input: CustomerNotificationNameInput,
): string {
  const raw = input.customerName?.trim() ?? "";
  if (!raw) return "";

  const displayName = getCustomerDisplayName({
    customerName: raw,
    nameStatus: input.nameStatus,
    locale: input.locale,
  });

  if (input.nameStatus !== "pending") {
    return displayName;
  }

  const label = input.pendingLabel.trim();
  if (!label) return displayName;

  if (input.locale === "en") {
    return `${displayName} (${label})`;
  }

  return `${displayName}（${label}）`;
}

/** Build messageParams customerName + nameStatus from a customer row. */
export function customerNameNotificationParams(customer: {
  customerName: string;
  nameStatus?: string | null;
}): { customerName: string; nameStatus: "confirmed" | "pending" } {
  return {
    customerName: customer.customerName,
    nameStatus: customer.nameStatus === "pending" ? "pending" : "confirmed",
  };
}
