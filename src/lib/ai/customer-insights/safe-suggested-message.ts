/**
 * Fixed Simplified-Chinese placeholder written when Provider draft fails Phase 2 validation.
 * Shared by server persist path and Customer UI so the UI never treats this as a real draft.
 *
 * Client-safe: no React, D1, env, provider, or validator imports.
 */
export const PHASE2_SAFE_SUGGESTED_MESSAGE_PLACEHOLDER =
  "（建议文案未通过合规校验，请自行撰写跟进内容。）";

export function isPhase2SafeSuggestedMessagePlaceholder(
  message: string | null | undefined,
): boolean {
  return message === PHASE2_SAFE_SUGGESTED_MESSAGE_PLACEHOLDER;
}

/** True when the stored suggestion may be shown in an editable draft. */
export function isSafeSuggestedMessageAvailable(
  message: string | null | undefined,
): boolean {
  if (typeof message !== "string") return false;
  if (!message.trim()) return false;
  return !isPhase2SafeSuggestedMessagePlaceholder(message);
}
