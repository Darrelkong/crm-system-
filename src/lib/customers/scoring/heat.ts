import { getDaysWithoutValidFollowUp } from "@/lib/reclamation/days";
import type { EffectiveSettings } from "@/lib/settings/effective";
import type { Customer } from "../../../../drizzle/schema/customers";
import { HIGH_ENGAGEMENT_STAGES } from "./constants";
import type { HeatLevel } from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysSince(iso: string, now: Date): number {
  return Math.floor(
    (now.getTime() - new Date(iso).getTime()) / MS_PER_DAY,
  );
}

export type HeatReasonPart = {
  key: string;
  params?: Record<string, string>;
};

export type HeatResult = {
  heatLevel: HeatLevel;
  heatReasonKeys: HeatReasonPart[];
};

export function calculateCustomerHeat(
  customer: Customer,
  settings: EffectiveSettings,
  now: Date = new Date(),
): HeatResult {
  const nowIso = now.toISOString();
  const daysWithoutValid = getDaysWithoutValidFollowUp(customer, now);
  const daysSinceLastValid = customer.lastValidFollowUpAt
    ? daysSince(customer.lastValidFollowUpAt, now)
    : null;
  const neverValid = !customer.lastValidFollowUpAt;
  const nextOverdue = !!(
    customer.nextFollowUpAt && customer.nextFollowUpAt < nowIso
  );
  const nextScheduled = !!(
    customer.nextFollowUpAt && customer.nextFollowUpAt >= nowIso
  );

  const warn1 = settings.reclaimWarningDay1;
  const reclaimDays = settings.automaticReclaimDays;

  if (
    daysWithoutValid >= warn1 ||
    nextOverdue ||
    daysWithoutValid >= Math.max(1, reclaimDays - 1)
  ) {
    const parts: HeatReasonPart[] = [];
    if (daysWithoutValid >= warn1) {
      parts.push({
        key: "longNoValidFollowUp",
        params: {
          days: String(daysWithoutValid),
          threshold: String(warn1),
        },
      });
    }
    if (nextOverdue) {
      parts.push({ key: "nextFollowUpOverdue" });
    }
    if (daysWithoutValid >= Math.max(1, reclaimDays - 1)) {
      parts.push({
        key: "nearReclaimThreshold",
        params: { days: String(reclaimDays) },
      });
    }
    return {
      heatLevel: "high_churn_risk",
      heatReasonKeys: parts.length > 0 ? parts : [{ key: "default" }],
    };
  }

  const recentValid7 =
    daysSinceLastValid !== null && daysSinceLastValid <= 7;
  const recentValid14 =
    daysSinceLastValid !== null && daysSinceLastValid <= 14;
  const activeStage = HIGH_ENGAGEMENT_STAGES.has(customer.salesStage);

  if (
    recentValid7 ||
    activeStage ||
    (nextScheduled && !neverValid)
  ) {
    const parts: HeatReasonPart[] = [];
    if (recentValid7) {
      parts.push({ key: "recentFollowUpDays", params: { days: "7" } });
    }
    if (activeStage) parts.push({ key: "highIntent" });
    if (nextScheduled && !neverValid) parts.push({ key: "nextFollowUpScheduled" });
    return {
      heatLevel: "high",
      heatReasonKeys: parts.length > 0 ? parts : [{ key: "recentFollowUp" }],
    };
  }

  if (recentValid14 || nextScheduled) {
    return {
      heatLevel: "medium",
      heatReasonKeys: recentValid14
        ? [{ key: "recentFollowUpDays", params: { days: "14" } }]
        : [{ key: "nextFollowUpScheduled" }],
    };
  }

  if (neverValid || (daysSinceLastValid !== null && daysSinceLastValid > 14)) {
    return {
      heatLevel: "silent",
      heatReasonKeys: neverValid
        ? [{ key: "newClient" }]
        : [
            {
              key: "longNoFollowUp",
              params: { days: String(daysSinceLastValid) },
            },
          ],
    };
  }

  return {
    heatLevel: "low",
    heatReasonKeys: [{ key: "lowActivity" }],
  };
}
