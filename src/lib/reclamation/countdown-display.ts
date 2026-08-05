import type { Customer } from "../../../drizzle/schema/customers";
import type { EffectiveSettings } from "@/lib/settings/effective";
import { isPublicPoolCustomer } from "@/lib/permissions/customers";
import { isReclamationEligibleCustomer } from "./constants";
import {
  getReclamationCycleStartedAt,
  isReclaimGraceActive,
} from "./cycle";
import { getDaysWithoutValidFollowUp } from "./days";

export const RECLAMATION_COUNTDOWN_STATES = [
  "normal",
  "warning",
  "high_risk",
  "urgent",
  "grace",
  "due",
] as const;

export type ReclamationCountdownState =
  (typeof RECLAMATION_COUNTDOWN_STATES)[number];

/**
 * Server-computed list display payload. Frontend only renders; no business-day math.
 */
export type ReclamationCountdownDisplay = {
  state: ReclamationCountdownState;
  daysRemaining: number | null;
  graceHoursRemaining: number | null;
  reclaimAt: string | null;
  graceUntil: string | null;
  reclaimDays: number;
  lastValidFollowUpAt: string | null;
};

export type ReclamationCountdownBadgeVariant =
  | "default"
  | "warning"
  | "danger"
  | "accent";

const MS_PER_HOUR = 60 * 60 * 1000;

export function classifyCountdownState(
  daysRemaining: number,
): Exclude<ReclamationCountdownState, "grace" | "due"> | null {
  if (!Number.isFinite(daysRemaining) || daysRemaining <= 0) {
    return null;
  }
  if (daysRemaining === 1) return "urgent";
  if (daysRemaining <= 7) return "high_risk";
  if (daysRemaining <= 14) return "warning";
  return "normal";
}

export function getProjectedReclaimAt(
  cycleStartedAt: string,
  reclaimDays: number,
): string {
  return new Date(
    new Date(cycleStartedAt).getTime() + reclaimDays * 24 * 60 * 60 * 1000,
  ).toISOString();
}

export function getGraceHoursRemaining(
  graceUntil: string,
  now: Date,
): number | null {
  const until = new Date(graceUntil);
  if (Number.isNaN(until.getTime())) return null;
  const remainingMs = until.getTime() - now.getTime();
  if (remainingMs <= 0) return null;
  return Math.max(1, Math.ceil(remainingMs / MS_PER_HOUR));
}

export function getReclamationCountdownBadgeVariant(
  state: ReclamationCountdownState,
): ReclamationCountdownBadgeVariant {
  switch (state) {
    case "normal":
      return "default";
    case "warning":
      return "warning";
    case "high_risk":
      return "default";
    case "urgent":
    case "due":
      return "danger";
    case "grace":
      return "accent";
    default:
      return "default";
  }
}

/** Extra class for orange high-risk (2–7 days) vs amber warning (8–14). */
export function getReclamationCountdownBadgeClassName(
  state: ReclamationCountdownState,
): string | undefined {
  if (state === "high_risk") {
    return "bg-orange-100 text-orange-900 border border-orange-200";
  }
  return undefined;
}

type CountdownCustomer = Pick<
  Customer,
  | "id"
  | "status"
  | "ownerId"
  | "salesStage"
  | "isPinned"
  | "lastValidFollowUpAt"
  | "reclamationCycleStartedAt"
  | "reclaimRuleGraceUntil"
  | "createdAt"
>;

/**
 * Build list countdown display using Phase 2 cycle/idle/grace helpers.
 * Returns null when the customer is not eligible or values cannot be computed.
 */
export function buildReclamationCountdownDisplay(
  customer: CountdownCustomer,
  settings: Pick<EffectiveSettings, "automaticReclaimDays">,
  now: Date = new Date(),
  options?: { isCollaborative?: boolean },
): ReclamationCountdownDisplay | null {
  try {
    if (options?.isCollaborative) return null;
    if (isPublicPoolCustomer(customer as Customer)) return null;
    if (customer.status !== "active" || !customer.ownerId) return null;
    if (!isReclamationEligibleCustomer(customer)) return null;

    const reclaimDays = settings.automaticReclaimDays;
    if (!Number.isFinite(reclaimDays) || reclaimDays < 1) return null;

    const idleDays = getDaysWithoutValidFollowUp(customer as Customer, now);
    if (!Number.isFinite(idleDays) || idleDays < 0) return null;

    const cycleStartedAt = getReclamationCycleStartedAt(customer as Customer);
    const reclaimAt = getProjectedReclaimAt(cycleStartedAt, reclaimDays);
    const lastValidFollowUpAt = customer.lastValidFollowUpAt ?? null;

    if (idleDays >= reclaimDays) {
      if (isReclaimGraceActive(customer, now) && customer.reclaimRuleGraceUntil) {
        const graceHoursRemaining = getGraceHoursRemaining(
          customer.reclaimRuleGraceUntil,
          now,
        );
        if (graceHoursRemaining == null) return null;
        return {
          state: "grace",
          daysRemaining: null,
          graceHoursRemaining,
          reclaimAt,
          graceUntil: customer.reclaimRuleGraceUntil,
          reclaimDays,
          lastValidFollowUpAt,
        };
      }

      return {
        state: "due",
        daysRemaining: null,
        graceHoursRemaining: null,
        reclaimAt,
        graceUntil: null,
        reclaimDays,
        lastValidFollowUpAt,
      };
    }

    const daysRemaining = reclaimDays - idleDays;
    const state = classifyCountdownState(daysRemaining);
    if (state == null) return null;

    return {
      state,
      daysRemaining,
      graceHoursRemaining: null,
      reclaimAt,
      graceUntil: null,
      reclaimDays,
      lastValidFollowUpAt,
    };
  } catch (error) {
    console.error("[reclamation-countdown] failed to compute display", {
      customerId: customer.id,
      error,
    });
    return null;
  }
}
