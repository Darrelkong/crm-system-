export const AUTO_RECLAIM_POOL_REASON = "自动回收：超过 8 天无有效跟进";

export const RECLAMATION_WARNING_DAY_6 = 6;
export const RECLAMATION_WARNING_DAY_7 = 7;
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
