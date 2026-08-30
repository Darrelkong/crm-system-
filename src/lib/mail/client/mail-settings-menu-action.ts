export type MailSettingsMenuView =
  | "display"
  | "compose"
  | "notifications"
  | "signature"
  | "notificationMailbox"
  | "admin";

export type MailSettingsMenuSelectResult =
  | { action: "open_admin_center" }
  | { action: "open_notification_mailbox" }
  | { action: "show_section"; view: Exclude<MailSettingsMenuView, "admin" | "notificationMailbox"> };

/**
 * Resolves a Mail settings gear menu selection.
 * Admin always opens MailAdminCenterDrawer — never an inline placeholder panel.
 */
export function resolveMailSettingsMenuSelect(
  id: MailSettingsMenuView,
  options: {
    showAdminEntry: boolean;
    hasAdminCenterHandler: boolean;
    showNotificationMailboxEntry?: boolean;
    hasNotificationMailboxHandler?: boolean;
  },
): MailSettingsMenuSelectResult | null {
  if (id === "admin") {
    if (options.showAdminEntry && options.hasAdminCenterHandler) {
      return { action: "open_admin_center" };
    }
    return null;
  }

  if (id === "notificationMailbox") {
    if (options.showNotificationMailboxEntry && options.hasNotificationMailboxHandler) {
      return { action: "open_notification_mailbox" };
    }
    return null;
  }

  return { action: "show_section", view: id };
}
