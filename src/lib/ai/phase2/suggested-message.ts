import { PHASE2_LIMITS } from "@/lib/ai/phase2/types";

export type SuggestedMessageValidationResult =
  | { ok: true; message: string }
  | { ok: false; reason: string };

const GUARANTEE_RE =
  /(保证|保證|一定能|百分百|稳过|穩過|guaranteed|definitely approved)/i;
const ADVICE_RE =
  /(法律意见|法律意見|税务结论|稅務結論|投资建议|投資建議|legal advice|tax advice|investment advice)/i;
const SENSITIVE_RE =
  /(?:\+?\d[\d\s\-()]{7,}\d)|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:微信|wechat|wx)[:：\s]*[A-Za-z0-9_\-]{4,}/i;

/**
 * Phase 5B validator only — does not generate messages or change runtime behavior.
 * Policy: messages should be Simplified Chinese, but this validator does NOT claim
 * complete traditional/simplified language detection. It enforces compliance,
 * sensitive-data, length, and HTML/fence checks, plus requiring some CJK text.
 */
export function validateSuggestedEmployeeMessage(
  message: unknown,
): SuggestedMessageValidationResult {
  if (typeof message !== "string") {
    return { ok: false, reason: "not_string" };
  }
  const trimmed = message.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.length > PHASE2_LIMITS.suggestedMessageMaxChars) {
    return { ok: false, reason: "too_long" };
  }
  if (/```/.test(trimmed) || /<[^>]+>/.test(trimmed)) {
    return { ok: false, reason: "html_or_fence" };
  }
  if (GUARANTEE_RE.test(trimmed)) {
    return { ok: false, reason: "guarantee_wording" };
  }
  if (ADVICE_RE.test(trimmed)) {
    return { ok: false, reason: "advice_wording" };
  }
  if (SENSITIVE_RE.test(trimmed)) {
    return { ok: false, reason: "sensitive_data" };
  }
  // Require CJK characters (policy language is Chinese). Proper-name traditional
  // characters alone are not rejected by heuristic language detection.
  if (!/[\u4e00-\u9fff]/.test(trimmed)) {
    return { ok: false, reason: "missing_chinese" };
  }
  return { ok: true, message: trimmed };
}
