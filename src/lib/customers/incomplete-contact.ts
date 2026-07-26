/**
 * Product reminder when only one of phone / WeChat is filled.
 * Both empty is handled by existing validation (not this reminder).
 */
export type IncompleteContactKind = "phone" | "wechat";

export function getIncompleteContactKind(
  phone: string | null | undefined,
  wechatId: string | null | undefined,
): IncompleteContactKind | null {
  const hasPhone = Boolean(phone?.trim());
  const hasWechat = Boolean(wechatId?.trim());
  if (hasPhone && hasWechat) return null;
  if (hasPhone && !hasWechat) return "wechat";
  if (!hasPhone && hasWechat) return "phone";
  return null;
}

/**
 * Height of MobileBottomNav stack (matches live layout):
 * pt-2 (0.5rem) + nav item row (~3.125rem / ~50px) + pb-[max(0.5rem, safe-area)].
 * Prefer this over guessing; verified against measured ~66px with zero safe-area.
 */
export const MOBILE_BOTTOM_NAV_STACK_OFFSET =
  "calc(3.625rem + max(0.5rem, env(safe-area-inset-bottom, 0px)))";

/**
 * Floating save FAB sits above MobileBottomNav with ~12px visual gap.
 * Reuses the same nav stack base as {@link MOBILE_BOTTOM_NAV_STACK_OFFSET}.
 */
export const MOBILE_FLOATING_SAVE_BOTTOM =
  "calc(3.625rem + max(0.5rem, env(safe-area-inset-bottom, 0px)) + 0.75rem)";
