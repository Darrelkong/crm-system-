import type { Customer } from "../../../../drizzle/schema/customers";
import type { EffectiveSettings } from "@/lib/settings/effective";
import { getDaysWithoutValidFollowUp } from "@/lib/reclamation/days";
import { isReclamationEligibleCustomer } from "@/lib/reclamation/constants";
import { isPublicPoolCustomer } from "@/lib/permissions/customers";
import type { BasicAnalysisInput } from "@/lib/ai/basic-analysis/types";

/**
 * Reclaim findings only for active owned private customers — mirrors
 * runReclamationCheck eligibility (no public pool / deleted / archived).
 */
export function isBasicAnalysisReclaimEligible(customer: Customer): boolean {
  if (customer.deletedAt) return false;
  if (customer.status !== "active") return false;
  if (!customer.ownerId) return false;
  if (isPublicPoolCustomer(customer)) return false;
  return isReclamationEligibleCustomer(customer);
}

export function buildBasicAnalysisInput(
  customer: Customer,
  settings: EffectiveSettings,
  options: {
    now?: Date;
    hasLatestNextAction?: boolean;
    hasAnyFollowUp?: boolean;
  } = {},
): BasicAnalysisInput {
  const now = options.now ?? new Date();
  const hasAnyFollowUp =
    options.hasAnyFollowUp ??
    !!(customer.lastFollowUpAt || customer.lastValidFollowUpAt);

  return {
    nowIso: now.toISOString(),
    customerName: customer.customerName,
    phone: customer.phone,
    wechatId: customer.wechatId,
    requestedProjectName: customer.requestedProjectName,
    salesStage: customer.salesStage,
    lastFollowUpAt: customer.lastFollowUpAt,
    lastValidFollowUpAt: customer.lastValidFollowUpAt,
    nextFollowUpAt: customer.nextFollowUpAt,
    hasLatestNextAction: options.hasLatestNextAction ?? false,
    hasAnyFollowUp,
    reclaimEligible: isBasicAnalysisReclaimEligible(customer),
    automaticReclaimDays: settings.automaticReclaimDays,
    reclaimWarningThresholdDays: settings.reclaimWarningThresholdDays,
    daysWithoutValidFollowUp: getDaysWithoutValidFollowUp(customer, now),
  };
}
