const TITLE_PREFIX = "i18n:";
const MESSAGE_PREFIX = "i18n:";

export function storeNotificationTitle(titleKey: string): string {
  return `${TITLE_PREFIX}${titleKey}`;
}

export function storeNotificationMessage(
  messageKey: string,
  params: Record<string, string> = {},
): string {
  return `${MESSAGE_PREFIX}${JSON.stringify({ key: messageKey, params })}`;
}

export function parseNotificationTitle(value: string): string | null {
  if (!value.startsWith(TITLE_PREFIX)) return null;
  return value.slice(TITLE_PREFIX.length);
}

export function parseNotificationMessage(
  value: string,
): { key: string; params: Record<string, string> } | null {
  if (!value.startsWith(MESSAGE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(value.slice(MESSAGE_PREFIX.length)) as {
      key?: string;
      params?: Record<string, string>;
    };
    if (!parsed.key) return null;
    return { key: parsed.key, params: parsed.params ?? {} };
  } catch {
    return null;
  }
}

export function notificationTypeToTitleKey(type: string): string {
  return `notificationTypes.${type.replace(/\./g, "_")}`;
}
