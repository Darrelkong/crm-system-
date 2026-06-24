import type { Customer } from "../../../drizzle/schema/customers";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Anchor for reclamation: last valid follow-up, or created_at if never contacted. */
export function getReclamationAnchorAt(customer: Customer): string {
  return customer.lastValidFollowUpAt ?? customer.createdAt;
}

export function getDaysWithoutValidFollowUp(
  customer: Customer,
  now: Date,
): number {
  const anchor = new Date(getReclamationAnchorAt(customer));
  const diffMs = now.getTime() - anchor.getTime();
  return Math.floor(diffMs / MS_PER_DAY);
}

/** UTC calendar date YYYY-MM-DD for deduplicating daily warnings. */
export function getWarningDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}
