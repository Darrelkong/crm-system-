import {
  notificationTypeToTitleKey,
  parseNotificationMessage,
  parseNotificationTitle,
} from "@/lib/notifications/i18n-storage";
import { getCustomerNotificationDisplayName } from "@/lib/notifications/customer-name";

type TranslateFn = (
  key: string,
  params?: Record<string, string>,
) => string;

function safeString(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function resolveParams(
  t: TranslateFn,
  params: Record<string, string>,
  locale: string,
): Record<string, string> {
  try {
    const resolved = { ...params };
    if (params.approvalType) {
      const typeKey = `customers.approvalTypes.${params.approvalType}`;
      const label = t(typeKey);
      resolved.approvalType =
        label === typeKey ? params.approvalType : label;
    }

    if (Object.prototype.hasOwnProperty.call(params, "customerName")) {
      resolved.customerName = getCustomerNotificationDisplayName({
        customerName: params.customerName,
        nameStatus: params.nameStatus,
        locale,
        pendingLabel: t("customers.namePendingBadge"),
      });
      // Templates never interpolate nameStatus — keep it out of visible output.
      delete resolved.nameStatus;
    }

    return resolved;
  } catch {
    return params;
  }
}

export function resolveNotificationTitle(
  t: TranslateFn,
  item: { title?: string | null; type?: string | null },
): string {
  const fallback = safeString(item.title);

  try {
    const storedKey = parseNotificationTitle(item.title);
    if (storedKey) {
      const translated = t(storedKey);
      if (translated && translated !== storedKey) return translated;
    }

    const typeKey = notificationTypeToTitleKey(item.type);
    const fromType = t(typeKey);
    if (fromType && fromType !== typeKey) return fromType;

    return fallback;
  } catch {
    return fallback;
  }
}

export function resolveNotificationMessage(
  t: TranslateFn,
  item: { message?: string | null; type?: string | null },
  options?: { locale?: string },
): string {
  const fallback = safeString(item.message);
  const locale = options?.locale ?? "zh-Hant";

  try {
    const stored = parseNotificationMessage(item.message);
    if (stored) {
      const translated = t(
        stored.key,
        resolveParams(t, stored.params, locale),
      );
      if (translated && translated !== stored.key) return translated;
    }

    return fallback;
  } catch {
    return fallback;
  }
}
