import type { Customer } from "../../../drizzle/schema/customers";
import { compareCustomersForList } from "@/lib/customers/list-sort";
import { isPublicPoolCustomer } from "@/lib/permissions/customers";
import { isReclamationEligibleCustomer } from "@/lib/reclamation/constants";
import { isReclaimGraceActive } from "@/lib/reclamation/cycle";
import { getDaysWithoutValidFollowUp } from "@/lib/reclamation/days";

export type ReclaimSortKey = {
  group: number;
  graceUntil: string | null;
  daysRemaining: number;
};

type ReclaimSortableCustomer = Pick<
  Customer,
  | "id"
  | "status"
  | "ownerId"
  | "salesStage"
  | "isPinned"
  | "pinnedAt"
  | "reclaimRuleGraceUntil"
  | "reclamationCycleStartedAt"
  | "lastValidFollowUpAt"
  | "createdAt"
  | "nextFollowUpAt"
>;

function isReclaimSortEligibleCustomer(
  customer: Pick<Customer, "status" | "ownerId" | "salesStage" | "isPinned">,
  options?: { isCollaborative?: boolean },
): boolean {
  if (options?.isCollaborative) {
    return false;
  }
  if (isPublicPoolCustomer(customer as Customer)) {
    return false;
  }
  if (customer.status !== "active" || !customer.ownerId) {
    return false;
  }
  return isReclamationEligibleCustomer(customer);
}

export function getReclaimSortKey(
  customer: ReclaimSortableCustomer,
  reclaimDays: number,
  now: Date = new Date(),
  options?: { isCollaborative?: boolean },
): ReclaimSortKey {
  if (!isReclaimSortEligibleCustomer(customer, options)) {
    return { group: 3, graceUntil: null, daysRemaining: 99_999 };
  }

  const idleDays = getDaysWithoutValidFollowUp(customer as Customer, now);
  if (idleDays >= reclaimDays) {
    if (isReclaimGraceActive(customer, now) && customer.reclaimRuleGraceUntil) {
      return {
        group: 1,
        graceUntil: customer.reclaimRuleGraceUntil,
        daysRemaining: 0,
      };
    }
    return { group: 0, graceUntil: null, daysRemaining: 0 };
  }

  return {
    group: 2,
    graceUntil: null,
    daysRemaining: reclaimDays - idleDays,
  };
}

export function compareCustomersForReclaimSoonest(
  a: ReclaimSortableCustomer,
  b: ReclaimSortableCustomer,
  reclaimDays: number,
  now: Date = new Date(),
  collaborativeFlags?: Map<string, boolean>,
): number {
  const keyA = getReclaimSortKey(a, reclaimDays, now, {
    isCollaborative: collaborativeFlags?.get(a.id) ?? false,
  });
  const keyB = getReclaimSortKey(b, reclaimDays, now, {
    isCollaborative: collaborativeFlags?.get(b.id) ?? false,
  });

  if (keyA.group !== keyB.group) {
    return keyA.group - keyB.group;
  }

  if (keyA.group === 1) {
    const graceCmp = (keyA.graceUntil ?? "").localeCompare(
      keyB.graceUntil ?? "",
    );
    if (graceCmp !== 0) {
      return graceCmp;
    }
  }

  if (keyA.group === 2 && keyA.daysRemaining !== keyB.daysRemaining) {
    return keyA.daysRemaining - keyB.daysRemaining;
  }

  return compareCustomersForList(a as Customer, b as Customer, now);
}

export function sortCustomersForReclaimSoonest<T extends ReclaimSortableCustomer>(
  customers: T[],
  reclaimDays: number,
  now: Date = new Date(),
  collaborativeFlags?: Map<string, boolean>,
): T[] {
  return [...customers].sort((a, b) =>
    compareCustomersForReclaimSoonest(
      a,
      b,
      reclaimDays,
      now,
      collaborativeFlags,
    ),
  );
}
