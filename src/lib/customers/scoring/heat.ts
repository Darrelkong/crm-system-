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

export type HeatResult = {
  heatLevel: HeatLevel;
  heatReason: string;
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
  const warn2 = settings.reclaimWarningDay2;
  const reclaimDays = settings.automaticReclaimDays;

  if (
    daysWithoutValid >= warn1 ||
    daysWithoutValid >= warn2 ||
    nextOverdue ||
    daysWithoutValid >= Math.max(1, reclaimDays - 1)
  ) {
    const parts: string[] = [];
    if (daysWithoutValid >= warn1) {
      parts.push(`已 ${daysWithoutValid} 天无有效跟进（达预警阈值 ${warn1} 天）`);
    }
    if (nextOverdue) {
      parts.push("下次跟进已超期");
    }
    if (daysWithoutValid >= Math.max(1, reclaimDays - 1)) {
      parts.push(`接近自动回收阈值（${reclaimDays} 天）`);
    }
    return {
      heatLevel: "high_churn_risk",
      heatReason: parts.join("；") || "流失风险较高",
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
    const parts: string[] = [];
    if (recentValid7) parts.push("近 7 天内有有效跟进");
    if (activeStage) parts.push("销售阶段较活跃");
    if (nextScheduled && !neverValid) parts.push("已安排下次跟进且未超期");
    return {
      heatLevel: "high",
      heatReason: parts.join("；") || "客户活跃度较高",
    };
  }

  if (recentValid14 || nextScheduled) {
    return {
      heatLevel: "medium",
      heatReason: recentValid14
        ? "近 14 天内有有效跟进"
        : "已设置下次跟进且未超期",
    };
  }

  if (neverValid || (daysSinceLastValid !== null && daysSinceLastValid > 14)) {
    return {
      heatLevel: "silent",
      heatReason: neverValid
        ? "从未有效跟进"
        : `超过 14 天无有效跟进（${daysSinceLastValid} 天）`,
    };
  }

  return {
    heatLevel: "low",
    heatReason: "有基本资料但近期跟进较少",
  };
}
