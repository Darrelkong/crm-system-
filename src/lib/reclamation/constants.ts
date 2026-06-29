/** Sales stages excluded from day-6/7 warnings and auto-reclaim. */
export const RECLAMATION_EXCLUDED_SALES_STAGES = [
  "closed_won",
  /** Legacy alias still stored on some customers */
  "converted",
  /** Admin-approved on-hold customers stay with the owner (D-1b). */
  "on_hold",
] as const;

export type ReclamationExcludedSalesStage =
  (typeof RECLAMATION_EXCLUDED_SALES_STAGES)[number];

export function isReclamationExcludedSalesStage(salesStage: string): boolean {
  return (RECLAMATION_EXCLUDED_SALES_STAGES as readonly string[]).includes(
    salesStage,
  );
}

type ReclamationCustomerGuard = {
  salesStage: string;
  isPinned: number;
};

/** Whether a customer may receive reclaim warnings or auto-reclaim. */
export function isReclamationEligibleCustomer(
  customer: ReclamationCustomerGuard,
): boolean {
  if (isReclamationExcludedSalesStage(customer.salesStage)) {
    return false;
  }
  if (customer.isPinned === 1) {
    return false;
  }
  return true;
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
  /**
   * Single pre-reclaim warning (E-4b).
   * NOTE: We keep the legacy "day_6" action string to avoid an audit-log
   * data migration; semantics are now "pre-reclaim warning".
   */
  warning: "customer.auto_reclaim_warning.day_6",
  /** @deprecated Legacy two-stage warning kept for historical audit rows. */
  warningDay6: "customer.auto_reclaim_warning.day_6",
  /** @deprecated Legacy two-stage warning kept for historical audit rows. */
  warningDay7: "customer.auto_reclaim_warning.day_7",
  reclaimed: "customer.auto_reclaimed_to_pool",
  failed: "customer.auto_reclaim_failed",
  taskCancelled: "task.cancelled.auto_reclaim",
} as const;

/**
 * App-level warning type written to reclamation_warning_logs.warning_type.
 * DB CHECK constraint only allows "day_6" / "day_7"; we reuse "day_6" for the
 * single E-4b warning to avoid a schema migration.
 */
export const RECLAIM_WARNING_LOG_TYPE = "day_6" as const;

export const NOTIFICATION_TITLES = {
  warning: "客户即将进入公共池",
  reclaimed: "客户已自动回收",
} as const;
