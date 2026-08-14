import type { Customer } from "../../../drizzle/schema/customers";
import { APPROVAL_AUDIT_ACTIONS } from "@/lib/approvals/constants";
import {
  mergePriorityFieldsForStageTransition,
  priorityAuditSnapshot,
  type PriorityFieldPatch,
} from "./priority-customer";

export type SalesStagePriorityUpdate = {
  salesStage: string;
  updatedBy: string;
  updatedAt: string;
} & Partial<PriorityFieldPatch>;

export function buildSalesStageUpdateWithPriority(
  customer: Pick<
    Customer,
    "salesStage" | "isPinned" | "pinnedAt" | "pinnedSource"
  >,
  nextSalesStage: string,
  reviewerId: string,
  now: string,
): {
  update: SalesStagePriorityUpdate;
  priorityAudit:
    | {
        action:
          | typeof APPROVAL_AUDIT_ACTIONS.priorityAutoSetOnHold
          | typeof APPROVAL_AUDIT_ACTIONS.priorityAutoRemovedLeaveOnHold;
        previous: Record<string, unknown>;
        next: Record<string, unknown>;
      }
    | null;
} {
  const base: SalesStagePriorityUpdate = {
    salesStage: nextSalesStage,
    updatedBy: reviewerId,
    updatedAt: now,
  };

  const { patch, auditAction } = mergePriorityFieldsForStageTransition(
    customer.salesStage,
    nextSalesStage,
    customer,
    now,
  );

  if (!patch || !auditAction) {
    return { update: base, priorityAudit: null };
  }

  const previous = priorityAuditSnapshot(customer);
  const next = priorityAuditSnapshot({
    ...customer,
    ...patch,
  });

  return {
    update: { ...base, ...patch },
    priorityAudit: { action: auditAction, previous, next },
  };
}
