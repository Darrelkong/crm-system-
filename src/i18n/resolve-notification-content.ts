import {
  notificationTypeToTitleKey,
  parseNotificationMessage,
  parseNotificationTitle,
} from "@/lib/notifications/i18n-storage";

type TranslateFn = (
  key: string,
  params?: Record<string, string>,
) => string;

function resolveParams(
  t: TranslateFn,
  params: Record<string, string>,
): Record<string, string> {
  const resolved = { ...params };
  if (params.approvalType) {
    const typeKey = `customers.approvalTypes.${params.approvalType}`;
    const label = t(typeKey);
    resolved.approvalType =
      label === typeKey ? params.approvalType : label;
  }
  return resolved;
}

export function resolveNotificationTitle(
  t: TranslateFn,
  item: { title: string; type: string },
): string {
  const storedKey = parseNotificationTitle(item.title);
  if (storedKey) {
    const translated = t(storedKey);
    if (translated !== storedKey) return translated;
  }

  const typeKey = notificationTypeToTitleKey(item.type);
  const fromType = t(typeKey);
  if (fromType !== typeKey) return fromType;

  return item.title;
}

export function resolveNotificationMessage(
  t: TranslateFn,
  item: { message: string; type: string },
): string {
  const stored = parseNotificationMessage(item.message);
  if (stored) {
    const translated = t(stored.key, resolveParams(t, stored.params));
    if (translated !== stored.key) return translated;
  }

  return item.message;
}
