import type { FollowUpOrganizeAiOutput } from "@/lib/ai/follow-up-organize/schema";

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

/**
 * Conservative fact-preservation gate. Returns false when the AI result
 * appears to introduce facts that were not present in the original text.
 */
export function passesFollowUpOrganizeFactCheck(
  originalText: string,
  ai: FollowUpOrganizeAiOutput,
): boolean {
  const organized = ai.organizedText;
  const combined = [organized, JSON.stringify(ai.extracted)].join("\n");

  if (
    hasNewToken(
      collectNormalized(PHONE_RE, originalText, normalizePhone),
      collectNormalized(PHONE_RE, combined, normalizePhone),
    )
  ) {
    return false;
  }
  if (
    hasNewToken(
      collectNormalized(EMAIL_RE, originalText, normalizeLoose),
      collectNormalized(EMAIL_RE, combined, normalizeLoose),
    )
  ) {
    return false;
  }
  if (
    hasNewToken(
      collectNormalized(AMOUNT_RE, originalText, normalizeLoose),
      collectNormalized(AMOUNT_RE, combined, normalizeLoose),
    )
  ) {
    return false;
  }
  if (
    hasNewToken(
      collectNormalized(PERCENT_RE, originalText, normalizeLoose),
      collectNormalized(PERCENT_RE, combined, normalizeLoose),
    )
  ) {
    return false;
  }
  if (
    hasNewToken(
      collectNormalized(ISO_DATE_RE, originalText, normalizeLoose),
      collectNormalized(ISO_DATE_RE, combined, normalizeLoose),
    )
  ) {
    return false;
  }
  if (
    hasNewToken(
      collectNormalized(CN_DATE_RE, originalText, normalizeLoose),
      collectNormalized(CN_DATE_RE, combined, normalizeLoose),
    )
  ) {
    return false;
  }

  // Soft → hard certainty escalation (zh-Hant / zh-Hans).
  // Avoid matching 「确定」 inside 「不确定」.
  const soft =
    /(可能|考慮|考虑|有點|有点|或許|或许|再看看|暫時|暂时|不確定|不确定)/;
  const hard =
    /(已決定|已决定|強烈|强烈|一定會|一定会|承諾|承诺|必定|確定辦理|确定办理|意向強烈|意向强烈)/;
  if (
    soft.test(originalText) &&
    hard.test(organized) &&
    !hard.test(originalText)
  ) {
    return false;
  }

  if (
    hasNewToken(
      collectNormalized(LATIN_PERSON_RE, originalText, normalizeLoose),
      collectNormalized(LATIN_PERSON_RE, combined, normalizeLoose),
    )
  ) {
    return false;
  }
  if (
    hasNewToken(
      collectNormalized(HONORIFIC_PERSON_RE, originalText, normalizeLoose),
      collectNormalized(HONORIFIC_PERSON_RE, combined, normalizeLoose),
    )
  ) {
    return false;
  }

  if (
    ai.extracted.agreedFollowUpAt?.isoCandidate &&
    !originalText.includes(ai.extracted.agreedFollowUpAt.isoCandidate) &&
    !originalText.includes(ai.extracted.agreedFollowUpAt.rawText)
  ) {
    return false;
  }

  return true;
}
