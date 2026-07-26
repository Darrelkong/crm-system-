/**
 * Customer name confirmation status (Phase 2B).
 * Never infer pending solely from customerName string equality.
 */

export const CUSTOMER_NAME_STATUSES = ["confirmed", "pending"] as const;

export type CustomerNameStatus = (typeof CUSTOMER_NAME_STATUSES)[number];

/** Canonical DB / API placeholder names when nameStatus is pending. */
export const PENDING_NAME_PLACEHOLDERS = ["X先生", "X女士"] as const;

export type PendingNamePlaceholder =
  (typeof PENDING_NAME_PLACEHOLDERS)[number];

export function isCustomerNameStatus(
  value: unknown,
): value is CustomerNameStatus {
  return (
    typeof value === "string" &&
    (CUSTOMER_NAME_STATUSES as readonly string[]).includes(value)
  );
}

export function isPendingNamePlaceholder(
  value: unknown,
): value is PendingNamePlaceholder {
  return (
    typeof value === "string" &&
    (PENDING_NAME_PLACEHOLDERS as readonly string[]).includes(value)
  );
}

export function normalizeCustomerNameStatus(
  value: unknown,
): CustomerNameStatus {
  return isCustomerNameStatus(value) ? value : "confirmed";
}
