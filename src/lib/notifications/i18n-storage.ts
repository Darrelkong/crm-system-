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

export function parseNotificationTitle(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(TITLE_PREFIX)) {
    return null;
  }
  const key = value.slice(TITLE_PREFIX.length).trim();
  return key.length > 0 ? key : null;
}

export function parseNotificationMessage(
  value: unknown,
): { key: string; params: Record<string, string> } | null {
  if (typeof value !== "string" || !value.startsWith(MESSAGE_PREFIX)) {
    return null;
  }

  const payload = value.slice(MESSAGE_PREFIX.length).trim();
  if (!payload) return null;

  try {
    const parsed = JSON.parse(payload) as {
      key?: unknown;
      params?: unknown;
    };
    if (typeof parsed.key !== "string" || !parsed.key.trim()) {
      return null;
    }

    const params: Record<string, string> = {};
    if (parsed.params && typeof parsed.params === "object" && parsed.params !== null) {
      for (const [paramKey, paramValue] of Object.entries(parsed.params)) {
        if (paramValue == null) continue;
        params[paramKey] = String(paramValue);
      }
    }

    return { key: parsed.key, params };
  } catch {
    return null;
  }
}

export function notificationTypeToTitleKey(type: unknown): string {
  if (typeof type !== "string" || !type.trim()) {
    return "notificationTypes.unknown";
  }
  return `notificationTypes.${type.replace(/\./g, "_")}`;
}
