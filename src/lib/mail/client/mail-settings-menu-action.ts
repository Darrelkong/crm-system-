export type MailSettingsMenuView =
  | "display"
  | "compose"
  | "notifications"
  | "signature"
  | "admin";

export type MailSettingsMenuSelectResult =
  | { action: "open_admin_center" }
  | { action: "show_section"; view: Exclude<MailSettingsMenuView, "admin"> };

/**
 * Resolves a Mail settings gear menu selection.
 * Admin always opens MailAdminCenterDrawer — never an inline placeholder panel.
 */
export function resolveMailSettingsMenuSelect(
  id: MailSettingsMenuView,
  options: { showAdminEntry: boolean; hasAdminCenterHandler: boolean },
): MailSettingsMenuSelectResult | null {
  if (id === "admin") {
    if (options.showAdminEntry && options.hasAdminCenterHandler) {
      return { action: "open_admin_center" };
    }
    return null;
  }

  return { action: "show_section", view: id };
}
