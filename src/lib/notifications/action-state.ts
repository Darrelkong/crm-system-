import type { NotificationActionState } from "../../../drizzle/schema/notifications";

export const NOTIFICATION_ACTION_STATE = {
  informational: "informational",
  pending: "pending",
  completed: "completed",
  expired: "expired",
} as const satisfies Record<NotificationActionState, NotificationActionState>;

/** Pending items cannot be bulk-marked read. */
export function isBulkMarkReadEligible(
  actionState: NotificationActionState,
): boolean {
  return actionState !== NOTIFICATION_ACTION_STATE.pending;
}

export function isPendingActionState(
  actionState: NotificationActionState,
): boolean {
  return actionState === NOTIFICATION_ACTION_STATE.pending;
}

export function countsTowardPendingActions(
  actionState: NotificationActionState,
): boolean {
  return actionState === NOTIFICATION_ACTION_STATE.pending;
}

/** Notification types that require user action in Work Items. */
export const ACTIONABLE_NOTIFICATION_TYPES = [
  "approval.pending",
  "reclamation.summary.staff",
  "reclamation.summary.admin",
  "customer.pending_second_conversion",
] as const;

export type ActionableNotificationType =
  (typeof ACTIONABLE_NOTIFICATION_TYPES)[number];

export function isActionableNotificationType(type: string): boolean {
  return (ACTIONABLE_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

export function defaultActionStateForType(type: string): NotificationActionState {
  if (isActionableNotificationType(type)) {
    return NOTIFICATION_ACTION_STATE.pending;
  }
  return NOTIFICATION_ACTION_STATE.informational;
}

/** Visible in Work Items lists and notification counts. */
export function isVisibleNotificationType(type: string): boolean {
  return !isLegacyPerCustomerReclaimWarningType(type);
}

export function staffReclamationGroupingKey(userId: string): string {
  return `reclamation:staff:${userId}`;
}

export function adminReclamationGroupingKey(): string {
  return "reclamation:admin:team";
}

/** Hide legacy per-customer reclaim warning cards from Work Items. */
export function isLegacyPerCustomerReclaimWarningType(type: string): boolean {
  return (
    type === "auto_reclaim_warning_day_6" ||
    type === "auto_reclaim_warning_day_7"
  );
}

export function isReclamationSummaryType(type: string): boolean {
  return (
    type === "reclamation.summary.staff" || type === "reclamation.summary.admin"
  );
}

export function summaryPriorityBand(
  counts: ReclamationSummaryCounts,
): "tomorrow" | "urgent" | "important" | "routine" {
  if (counts.tomorrowCount > 0) return "tomorrow";
  if (counts.within7Count > 0) return "urgent";
  if (counts.within14Count > 0) return "important";
  return "routine";
}

export type ReclamationSummaryCounts = {
  totalCount: number;
  tomorrowCount: number;
  within7Count: number;
  within14Count: number;
  routineCount: number;
  earliestReleaseAt: string | null;
  memberCount?: number;
};
