import type { Database } from "@/lib/db";
import {
  getPendingActionCount,
  getUnreadNonPendingNotificationCount,
  getUnreadNotificationCount,
  getWorkItemsAttentionCount,
  type NotificationBadgeCounts,
} from "./queries";

/** Legacy reference: separate notification badge count queries. */
export async function getNotificationBadgeCountsLegacy(
  db: Database,
  userId: string,
): Promise<NotificationBadgeCounts> {
  const [unreadCount, pendingCount, unreadNonPendingCount] = await Promise.all([
    getUnreadNotificationCount(db, userId),
    getPendingActionCount(db, userId),
    getUnreadNonPendingNotificationCount(db, userId),
  ]);
  const attentionCount = await getWorkItemsAttentionCount(db, userId);
  return {
    unreadCount,
    pendingCount,
    unreadNonPendingCount,
    attentionCount,
  };
}

/** Legacy unread-count API path: 4 physical aggregate queries. */
export async function getUnreadCountApiCountsLegacy(
  db: Database,
  userId: string,
): Promise<Pick<NotificationBadgeCounts, "unreadCount" | "pendingCount" | "attentionCount">> {
  const [unreadCount, pendingCount, attentionCount] = await Promise.all([
    getUnreadNotificationCount(db, userId),
    getPendingActionCount(db, userId),
    getWorkItemsAttentionCount(db, userId),
  ]);
  return { unreadCount, pendingCount, attentionCount };
}
