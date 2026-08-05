import type { Customer } from "../../../drizzle/schema/customers";

/**
 * Unified reclamation cycle anchor.
 * Priority: explicit cycle start → last valid follow-up → createdAt.
 */
export function getReclamationCycleStartedAt(customer: Customer): string {
  return (
    customer.reclamationCycleStartedAt ??
    customer.lastValidFollowUpAt ??
    customer.createdAt
  );
}

export type ReclamationCycleResetReason =
  | "customer_created"
  | "valid_follow_up"
  | "pool_claim"
  | "admin_transfer"
  | "staff_delete_transfer";

export function buildReclamationCycleResetFields(
  anchorIso: string,
): Pick<Customer, "reclamationCycleStartedAt" | "reclaimRuleGraceUntil"> {
  return {
    reclamationCycleStartedAt: anchorIso,
    reclaimRuleGraceUntil: null,
  };
}

export function isReclaimGraceActive(
  customer: Pick<Customer, "reclaimRuleGraceUntil">,
  now: Date,
): boolean {
  if (!customer.reclaimRuleGraceUntil) return false;
  const until = new Date(customer.reclaimRuleGraceUntil);
  return !Number.isNaN(until.getTime()) && until.getTime() > now.getTime();
}
