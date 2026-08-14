import type { Customer } from "../../../drizzle/schema/customers";

export const PINNED_SOURCES = [
  "on_hold_auto",
  "admin_direct",
  "approval",
  "legacy",
] as const;

export type PinnedSource = (typeof PINNED_SOURCES)[number];

export const PRIORITY_REQUEST_TYPES = [
  "set_priority_customer",
  "unset_priority_customer",
] as const;

export type PriorityRequestType = (typeof PRIORITY_REQUEST_TYPES)[number];

export const PRIORITY_ERROR_CODES = {
  ALREADY_PRIORITY: "CUSTOMER_ALREADY_PRIORITY",
  NOT_PRIORITY: "CUSTOMER_NOT_PRIORITY",
  ON_HOLD_REQUIRES_PRIORITY: "CUSTOMER_ON_HOLD_REQUIRES_PRIORITY",
  PENDING_PRIORITY_APPROVAL: "PRIORITY_APPROVAL_ALREADY_PENDING",
  STALE_PRIORITY_APPROVAL: "PRIORITY_APPROVAL_STALE",
  INVALID_PRIORITY_ACTION: "INVALID_PRIORITY_ACTION",
} as const;

export type PriorityState = {
  isPinned: number;
  pinnedAt: string | null;
  pinnedSource: PinnedSource | null;
};

export type PriorityFieldPatch = {
  isPinned: number;
  pinnedAt: string | null;
  pinnedSource: PinnedSource | null;
};

export function toPriorityState(
  customer: Pick<Customer, "isPinned" | "pinnedAt" | "pinnedSource">,
): PriorityState {
  return {
    isPinned: customer.isPinned,
    pinnedAt: customer.pinnedAt,
    pinnedSource: (customer.pinnedSource as PinnedSource | null) ?? null,
  };
}

export function isPriorityCustomer(customer: Pick<Customer, "isPinned">): boolean {
  return customer.isPinned === 1;
}

export function isLegacyLikePinnedSource(
  pinnedSource: PinnedSource | null | undefined,
): boolean {
  return pinnedSource === "legacy" || pinnedSource == null;
}

export function resolveSalesStagePriorityTransition(
  previousSalesStage: string,
  nextSalesStage: string,
  current: PriorityState,
  now: string,
): PriorityFieldPatch | null {
  if (previousSalesStage === nextSalesStage) {
    return null;
  }

  const wasOnHold = previousSalesStage === "on_hold";
  const isOnHold = nextSalesStage === "on_hold";

  if (!wasOnHold && isOnHold) {
    if (current.isPinned !== 1) {
      return {
        isPinned: 1,
        pinnedAt: now,
        pinnedSource: "on_hold_auto",
      };
    }
    return null;
  }

  if (wasOnHold && !isOnHold) {
    if (current.isPinned === 1 && current.pinnedSource === "on_hold_auto") {
      return {
        isPinned: 0,
        pinnedAt: null,
        pinnedSource: null,
      };
    }
    return null;
  }

  return null;
}

export function buildOnHoldCreatePriorityFields(now: string): PriorityFieldPatch {
  return {
    isPinned: 1,
    pinnedAt: now,
    pinnedSource: "on_hold_auto",
  };
}

export function buildAdminSetPriorityFields(now: string): PriorityFieldPatch {
  return {
    isPinned: 1,
    pinnedAt: now,
    pinnedSource: "admin_direct",
  };
}

export function buildAdminRemovePriorityFields(): PriorityFieldPatch {
  return {
    isPinned: 0,
    pinnedAt: null,
    pinnedSource: null,
  };
}

export function buildApprovalSetPriorityFields(now: string): PriorityFieldPatch {
  return {
    isPinned: 1,
    pinnedAt: now,
    pinnedSource: "approval",
  };
}

export function canRemovePriorityForStage(salesStage: string): boolean {
  return salesStage !== "on_hold";
}

export function shouldSkipSetPriorityMutation(
  customer: Pick<Customer, "isPinned" | "pinnedSource">,
): boolean {
  return customer.isPinned === 1;
}

export function shouldSkipUnsetPriorityMutation(
  customer: Pick<Customer, "isPinned" | "salesStage">,
): boolean {
  return (
    customer.isPinned !== 1 ||
    !canRemovePriorityForStage(customer.salesStage)
  );
}

export function priorityAuditSnapshot(
  customer: Pick<Customer, "isPinned" | "pinnedAt" | "pinnedSource">,
): Record<string, unknown> {
  return {
    isPinned: customer.isPinned === 1,
    pinnedAt: customer.pinnedAt,
    pinnedSource: customer.pinnedSource,
  };
}

export function mergePriorityFieldsForStageTransition(
  previousSalesStage: string,
  nextSalesStage: string,
  customer: Pick<Customer, "isPinned" | "pinnedAt" | "pinnedSource">,
  now: string,
): {
  patch: PriorityFieldPatch | null;
  auditAction:
    | "customer.priority.auto_set_on_hold"
    | "customer.priority.auto_removed_leave_on_hold"
    | null;
} {
  const patch = resolveSalesStagePriorityTransition(
    previousSalesStage,
    nextSalesStage,
    toPriorityState(customer),
    now,
  );
  if (!patch) {
    return { patch: null, auditAction: null };
  }

  const wasOnHold = previousSalesStage === "on_hold";
  const isOnHold = nextSalesStage === "on_hold";
  if (!wasOnHold && isOnHold) {
    return { patch, auditAction: "customer.priority.auto_set_on_hold" };
  }
  if (wasOnHold && !isOnHold) {
    return { patch, auditAction: "customer.priority.auto_removed_leave_on_hold" };
  }
  return { patch, auditAction: null };
}
