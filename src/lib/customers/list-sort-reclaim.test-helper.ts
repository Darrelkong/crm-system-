import type { Customer } from "../../../drizzle/schema/customers";
import { compareCustomersForList } from "@/lib/customers/list-sort";
import { NEAR_RELEASE_RISK_DAYS } from "@/lib/customers/list-sort-reclaim";
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

export function getNearReleaseRiskSortKey(
  customer: ReclaimSortableCustomer,
  reclaimDays: number,
  now: Date = new Date(),
  options?: { isCollaborative?: boolean },
): { riskBucket: number; riskGroup: number; graceUntil: string | null } {
  const key = getReclaimSortKey(customer, reclaimDays, now, options);

  if (key.group === 3) {
    return { riskBucket: 1, riskGroup: 99_999, graceUntil: null };
  }

  const inRiskWindow =
    key.group === 0 ||
    key.group === 1 ||
    (key.group === 2 && key.daysRemaining <= NEAR_RELEASE_RISK_DAYS);

  if (!inRiskWindow) {
    return { riskBucket: 1, riskGroup: 99_999, graceUntil: null };
  }

  const riskGroup =
    key.group === 0 ? 0 : key.group === 1 ? 1 : 1 + key.daysRemaining;

  return {
    riskBucket: 0,
    riskGroup,
    graceUntil: key.group === 1 ? key.graceUntil : null,
  };
}

export function compareNearReleaseRiskPriority(
  a: ReclaimSortableCustomer,
  b: ReclaimSortableCustomer,
  reclaimDays: number,
  now: Date = new Date(),
  collaborativeFlags?: Map<string, boolean>,
): number {
  const keyA = getNearReleaseRiskSortKey(a, reclaimDays, now, {
    isCollaborative: collaborativeFlags?.get(a.id) ?? false,
  });
  const keyB = getNearReleaseRiskSortKey(b, reclaimDays, now, {
    isCollaborative: collaborativeFlags?.get(b.id) ?? false,
  });

  if (keyA.riskBucket !== keyB.riskBucket) {
    return keyA.riskBucket - keyB.riskBucket;
  }
  if (keyA.riskGroup !== keyB.riskGroup) {
    return keyA.riskGroup - keyB.riskGroup;
  }
  if (keyA.riskGroup === 1) {
    const graceCmp = (keyA.graceUntil ?? "").localeCompare(
      keyB.graceUntil ?? "",
    );
    if (graceCmp !== 0) {
      return graceCmp;
    }
  }

  return 0;
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
