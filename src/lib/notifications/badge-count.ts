/** Returns badge label, or null when count is 0 (hide badge). */
export function formatNotificationBadgeCount(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) {
    return null;
  }
  if (count > 99) {
    return "99+";
  }
  return String(count);
}

export const NOTIFICATION_UNREAD_CHANGED_EVENT = "crm:notifications-unread-changed";

export function dispatchNotificationUnreadChanged(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(NOTIFICATION_UNREAD_CHANGED_EVENT));
}
