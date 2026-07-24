/**
 * Phase 2 fact-safety checks.
 * Self-contained to avoid coupling to follow-up organizer domain.
 * Patterns mirror Phase 4C conservative gates without importing that module.
 */

const PHONE_RE = /(?:\+?\d[\d\s\-()]{6,}\d)/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const AMOUNT_RE =
  /(?:HK\$|USD|CNY|RMB|\$|€|£|港幣|人民幣|美元)\s*[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?\s*(?:元|萬|万|块|塊)/gi;
const PERCENT_RE = /\d+(?:\.\d+)?%/g;
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;
const CN_DATE_RE = /\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/g;
const LATIN_PERSON_RE = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
const HONORIFIC_PERSON_RE =
  /[\u4e00-\u9fff]{2,4}(?:先生|小姐|女士|經理|经理|總監|总监)/g;

function collectNormalized(
  re: RegExp,
  text: string,
  normalize: (value: string) => string,
): Set<string> {
  const out = new Set<string>();
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const copy = new RegExp(re.source, flags);
  for (const match of text.matchAll(copy)) {
    out.add(normalize(match[0]));
  }
  return out;
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

function normalizeLoose(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function hasNewToken(original: Set<string>, candidate: Set<string>): boolean {
  for (const item of candidate) {
    if (!original.has(item)) return true;
  }
  return false;
}

export type Phase2FactSafetyFailure =
  | "new_phone"
  | "new_email"
  | "new_amount"
  | "new_percent"
  | "new_date"
  | "new_person"
  | "certainty_upgrade"
  | "html_or_script";

export type Phase2FactSafetyResult =
  | { ok: true }
  | { ok: false; reason: Phase2FactSafetyFailure };

/**
 * Returns ok=false when candidate text introduces facts absent from allowed context text.
 */
export function validatePhase2FactSafety(
  allowedContextText: string,
  candidateText: string,
): Phase2FactSafetyResult {
  if (/<script|<\/?[a-z][\s\S]*>/i.test(candidateText)) {
    return { ok: false, reason: "html_or_script" };
  }

  const checks: Array<{
    reason: Phase2FactSafetyFailure;
    re: RegExp;
    normalize: (v: string) => string;
  }> = [
    { reason: "new_phone", re: PHONE_RE, normalize: normalizePhone },
    { reason: "new_email", re: EMAIL_RE, normalize: normalizeLoose },
    { reason: "new_amount", re: AMOUNT_RE, normalize: normalizeLoose },
    { reason: "new_percent", re: PERCENT_RE, normalize: normalizeLoose },
    { reason: "new_date", re: ISO_DATE_RE, normalize: normalizeLoose },
    { reason: "new_date", re: CN_DATE_RE, normalize: normalizeLoose },
    { reason: "new_person", re: LATIN_PERSON_RE, normalize: normalizeLoose },
    {
      reason: "new_person",
      re: HONORIFIC_PERSON_RE,
      normalize: normalizeLoose,
    },
  ];

  for (const check of checks) {
    if (
      hasNewToken(
        collectNormalized(check.re, allowedContextText, check.normalize),
        collectNormalized(check.re, candidateText, check.normalize),
      )
    ) {
      return { ok: false, reason: check.reason };
    }
  }

  const soft =
    /(可能|考慮|考虑|有點|有点|或許|或许|再看看|暫時|暂时|不確定|不确定)/;
  const hard =
    /(已決定|已决定|強烈|强烈|一定會|一定会|承諾|承诺|必定|確定辦理|确定办理|意向強烈|意向强烈)/;
  if (
    soft.test(allowedContextText) &&
    hard.test(candidateText) &&
    !hard.test(allowedContextText)
  ) {
    return { ok: false, reason: "certainty_upgrade" };
  }

  return { ok: true };
}

export function buildAllowedContextBlob(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join("\n");
}
