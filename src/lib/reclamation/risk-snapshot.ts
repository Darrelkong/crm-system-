import type { Customer } from "../../../drizzle/schema/customers";
import type { ReclamationRiskBand } from "../../../drizzle/schema/reclamation-action-items";
import type { EffectiveSettings } from "@/lib/settings/effective";
import { isReclamationEligibleCustomer } from "./constants";
import { isReclaimGraceActive, getReclamationCycleStartedAt } from "./cycle";
import { getDaysWithoutValidFollowUp } from "./days";
export type ReclamationRiskSnapshot = {
  customerId: string;
  ownerId: string;
  cycleStartedAt: string;
  idleDays: number;
  reclaimDays: number;
  riskBand: ReclamationRiskBand;
  projectedReclaimAt: string;
};

export function classifyReclamationRiskBand(
  idleDays: number,
  reclaimDays: number,
): ReclamationRiskBand | null {
  if (idleDays <= 0 || idleDays >= reclaimDays) {
    return null;
  }

  const daysRemaining = reclaimDays - idleDays;
  if (daysRemaining === 1) {
    return "tomorrow";
  }
  if (daysRemaining <= 7) {
    return "within_7";
  }
  if (daysRemaining <= 14) {
    return "within_14";
  }
  if (idleDays >= 7) {
    return "routine";
  }
  return null;
}

export function isCustomerAtReclamationRisk(
  customer: Customer,
  settings: EffectiveSettings,
  now: Date,
): ReclamationRiskSnapshot | null {
  if (customer.status !== "active" || !customer.ownerId) {
    return null;
  }
  if (!isReclamationEligibleCustomer(customer)) {
    return null;
  }

  const reclaimDays = settings.automaticReclaimDays;
  const idleDays = getDaysWithoutValidFollowUp(customer, now);

  if (idleDays >= reclaimDays) {
    if (isReclaimGraceActive(customer, now)) {
      return null;
    }
    return null;
  }

  const band = classifyReclamationRiskBand(idleDays, reclaimDays);
  if (band === null) {
    return null;
  }

  const cycleStartedAt = getReclamationCycleStartedAt(customer);
  const projectedReclaimAt = new Date(
    new Date(cycleStartedAt).getTime() + reclaimDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  return {
    customerId: customer.id,
    ownerId: customer.ownerId,
    cycleStartedAt,
    idleDays,
    reclaimDays,
    riskBand: band,
    projectedReclaimAt,
  };
}

export function aggregateRiskCounts(
  snapshots: ReclamationRiskSnapshot[],
): {
  totalCount: number;
  tomorrowCount: number;
  within7Count: number;
  within14Count: number;
  routineCount: number;
  earliestReleaseAt: string | null;
} {
  let tomorrowCount = 0;
  let within7Count = 0;
  let within14Count = 0;
  let routineCount = 0;
  let earliestReleaseAt: string | null = null;

  for (const snapshot of snapshots) {
    switch (snapshot.riskBand) {
      case "tomorrow":
        tomorrowCount += 1;
        break;
      case "within_7":
        within7Count += 1;
        break;
      case "within_14":
        within14Count += 1;
        break;
      case "routine":
        routineCount += 1;
        break;
      default:
        break;
    }

    if (
      earliestReleaseAt == null ||
      snapshot.projectedReclaimAt < earliestReleaseAt
    ) {
      earliestReleaseAt = snapshot.projectedReclaimAt;
    }
  }

  return {
    totalCount: snapshots.length,
    tomorrowCount,
    within7Count,
    within14Count,
    routineCount,
    earliestReleaseAt,
  };
}
