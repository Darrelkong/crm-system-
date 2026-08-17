import { PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY } from "@/lib/constants/customer-sources";

/** Canonical entry_method value for Quick Entry creates (Phase 2+). */
export const QUICK_ENTRY_ENTRY_METHOD = PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY;

type QuickEntryCustomerLike = {
  source: string;
  entryMethod?: string | null;
};

/** Detect Quick Entry customers for future Phase 3 without rewriting history. */
export function isQuickEntryCustomer(customer: QuickEntryCustomerLike): boolean {
  if (customer.entryMethod === QUICK_ENTRY_ENTRY_METHOD) {
    return true;
  }
  return (
    customer.entryMethod == null &&
    customer.source === PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY
  );
}
