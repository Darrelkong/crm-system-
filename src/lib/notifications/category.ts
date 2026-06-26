export type NotificationCategory =
  | "customer"
  | "approval"
  | "system"
  | "security";

export function getNotificationCategory(type: string): NotificationCategory {
  if (type.startsWith("approval.")) {
    return "approval";
  }
  if (
    type.startsWith("auto_reclaim") ||
    type.startsWith("customer_") ||
    type.startsWith("customer.")
  ) {
    return "customer";
  }
  if (type === "backup_failed") {
    return "security";
  }
  return "system";
}

export function getNotificationTypeLabelKey(type: string): string {
  return `notificationTypes.${type.replace(/\./g, "_")}`;
}
