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

export function defaultActionStateForType(type: string): NotificationActionState {
  if (type === "approval.pending") {
    return NOTIFICATION_ACTION_STATE.pending;
  }
  if (
    type === "reclamation.summary.staff" ||
    type === "reclamation.summary.admin"
  ) {
    return NOTIFICATION_ACTION_STATE.pending;
  }
  return NOTIFICATION_ACTION_STATE.informational;
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
