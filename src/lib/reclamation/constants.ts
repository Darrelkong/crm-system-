/** Sales stages excluded from day-6/7 warnings and 8-day auto-reclaim. */
export const RECLAMATION_EXCLUDED_SALES_STAGES = [
  "closed_won",
  "closed_lost",
  "invalid",
  "on_hold",
] as const;

export type ReclamationExcludedSalesStage =
  (typeof RECLAMATION_EXCLUDED_SALES_STAGES)[number];

export function isReclamationExcludedSalesStage(salesStage: string): boolean {
  return (RECLAMATION_EXCLUDED_SALES_STAGES as readonly string[]).includes(
    salesStage,
  );
}

export const AUTO_RECLAIM_POOL_REASON_PREFIX = "自动回收：超过 ";

/** @deprecated Use system_settings via getEffectiveSettings() */
export const AUTO_RECLAIM_POOL_REASON = "自动回收：超过 8 天无有效跟进";

/** @deprecated Use system_settings via getEffectiveSettings() */
export const RECLAMATION_WARNING_DAY_6 = 6;
/** @deprecated Use system_settings via getEffectiveSettings() */
export const RECLAMATION_WARNING_DAY_7 = 7;
/** @deprecated Use system_settings via getEffectiveSettings() */
export const RECLAMATION_RECLAIM_DAYS = 8;

export const RECLAMATION_AUDIT_ACTIONS = {
  warningDay6: "customer.auto_reclaim_warning.day_6",
  warningDay7: "customer.auto_reclaim_warning.day_7",
  reclaimed: "customer.auto_reclaimed_to_pool",
  failed: "customer.auto_reclaim_failed",
  taskCancelled: "task.cancelled.auto_reclaim",
} as const;

export const NOTIFICATION_TITLES = {
  warningDay6: "跟进预警（第 6 天）",
  warningDay7: "跟进预警（第 7 天）",
  reclaimed: "客户已自动回收",
} as const;
