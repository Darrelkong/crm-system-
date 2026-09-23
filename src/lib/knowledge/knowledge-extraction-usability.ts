import { normalizeKnowledgeSourceText } from "@/lib/knowledge/source-text-normalization";
import {
  GENERIC_VISION_EXTRACTION_PLACEHOLDER,
  isGenericExtractionPlaceholderText,
} from "@/lib/knowledge/source-duplicate";

/** Shown in local mock preview when no real vision runs for arbitrary uploads. */
export const LOCAL_PREVIEW_MOCK_NO_VISION_MESSAGE =
  "本地预览未执行真实视觉识别";

const FIXTURE_MARKER_PATTERN = /\[fixture:[^\]]+\]/i;
const INTERNAL_PREVIEW_MARKER_PATTERN = /\[本地预览[^\]]*\]/i;

export type KnowledgeExtractionUsabilityAssessment = {
  usable: boolean;
  requiresHumanReview: boolean;
  reason: "unusable_placeholder" | "unusable_empty" | "unusable_preview_only" | null;
};

export function containsInternalFixtureMarker(text: string): boolean {
  return FIXTURE_MARKER_PATTERN.test(text);
}

export function stripInternalExtractionMarkers(text: string): string {
  return normalizeKnowledgeSourceText(
    text
      .replace(FIXTURE_MARKER_PATTERN, "")
      .replace(INTERNAL_PREVIEW_MARKER_PATTERN, "")
      .trim(),
  );
}

export function isPreviewOnlyMockVisionMessage(text: string): boolean {
  const normalized = normalizeKnowledgeSourceText(text);
  return (
    normalized === LOCAL_PREVIEW_MOCK_NO_VISION_MESSAGE ||
    normalized.includes(LOCAL_PREVIEW_MOCK_NO_VISION_MESSAGE)
  );
}

export function isNonEvidenceExtractionText(text: string): boolean {
  const stripped = stripInternalExtractionMarkers(text);
  if (!stripped) return true;
  if (isGenericExtractionPlaceholderText(stripped)) return true;
  if (isPreviewOnlyMockVisionMessage(stripped)) return true;
  if (containsInternalFixtureMarker(text)) return true;
  if (/^\[无法可靠读取来源[^\]]*\]$/u.test(stripped)) return true;
  return false;
}

export function hasSubstantiveSourceEvidence(text: string): boolean {
  const stripped = stripInternalExtractionMarkers(text);
  if (!stripped || isNonEvidenceExtractionText(stripped)) return false;
  const meaningfulLines = stripped
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (meaningfulLines.length === 0) return false;
  const compact = stripped.replace(/\s+/g, "");
  return compact.length >= 8;
}

export function assessVisionExtractionUsability(rawText: string): KnowledgeExtractionUsabilityAssessment {
  const stripped = stripInternalExtractionMarkers(rawText);
  if (!stripped) {
    return {
      usable: false,
      requiresHumanReview: true,
      reason: "unusable_empty",
    };
  }
  if (isPreviewOnlyMockVisionMessage(stripped)) {
    return {
      usable: false,
      requiresHumanReview: true,
      reason: "unusable_preview_only",
    };
  }
  if (
    isGenericExtractionPlaceholderText(stripped) ||
    stripped === GENERIC_VISION_EXTRACTION_PLACEHOLDER
  ) {
    return {
      usable: false,
      requiresHumanReview: true,
      reason: "unusable_placeholder",
    };
  }
  if (!hasSubstantiveSourceEvidence(stripped)) {
    return {
      usable: false,
      requiresHumanReview: true,
      reason: "unusable_empty",
    };
  }
  return {
    usable: true,
    requiresHumanReview: true,
    reason: null,
  };
}

export const ORGANIZER_GENERAL_CONTENT_MISSING_RATIO = 0.34;
export const ORGANIZER_GENERAL_CONTENT_MIN_SEGMENTS = 4;

export type CriticalFactCategory =
  | "money_amount"
  | "percentage"
  | "date_deadline"
  | "transaction_limit"
  | "eligibility_threshold"
  | "bank_or_company"
  | "jurisdiction"
  | "required_document"
  | "payment_channel"
  | "structured_requirement";

const CRITICAL_REGEXES: RegExp[] = [
  /\d{1,3}(?:,\d{3})+(?:\s*(?:美元|美金))?/giu,
  /\d+(?:\.\d+)?\s*%/giu,
  /\d+\s*[wW](?:\s*(?:美金|美元))?/giu,
  /\d+\s*(?:万|萬)\s*(?:美元|美金|港币|港幣)?/giu,
  /\d+\s*(?:天|日)(?:\s*内|\s*內)?/giu,
  /\d+\s*[-–—]\s*\d+\s*(?:周|週|个月|個月|天|日)/giu,
];

const CRITICAL_LITERALS: Array<{ value: string; category: CriticalFactCategory }> = [
  { value: "Chase Private Client", category: "bank_or_company" },
  { value: "大通私人银行账户", category: "bank_or_company" },
  { value: "ACH", category: "payment_channel" },
  { value: "Zelle", category: "payment_channel" },
  { value: "KYC", category: "structured_requirement" },
  { value: "ECHFRONT", category: "bank_or_company" },
  { value: "Turkey", category: "jurisdiction" },
  { value: "土耳其", category: "jurisdiction" },
  { value: "Hong Kong", category: "jurisdiction" },
  { value: "香港", category: "jurisdiction" },
];

function collectRegexMatches(text: string, pattern: RegExp): string[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  const matches: string[] = [];
  for (const match of text.matchAll(regex)) {
    if (match[0]?.trim()) matches.push(match[0].trim());
  }
  return matches;
}

function normalizeCompact(value: string): string {
  return normalizeKnowledgeSourceText(value).replace(/\s+/g, "").toLowerCase();
}

export function organizerOutputContainsFact(outputText: string, anchor: string): boolean {
  const outputCompact = normalizeCompact(outputText);
  const anchorCompact = normalizeCompact(anchor);
  if (!anchorCompact) return true;
  if (outputCompact.includes(anchorCompact)) return true;
  if (/^\d+[wW]/.test(anchor)) {
    const digits = anchor.match(/\d+/)?.[0];
    return Boolean(digits && new RegExp(`${digits}\\s*[wW]`, "i").test(outputText));
  }
  if (anchorCompact.includes("天") && /\d+/.test(anchorCompact)) {
    const digits = anchor.match(/\d+/)?.[0];
    return Boolean(digits && new RegExp(`${digits}\\s*天`, "u").test(outputText));
  }
  return false;
}

export function extractCriticalFactAnchors(text: string): string[] {
  const anchors: string[] = [];
  for (const pattern of CRITICAL_REGEXES) {
    anchors.push(...collectRegexMatches(text, pattern));
  }
  for (const literal of CRITICAL_LITERALS) {
    if (text.includes(literal.value)) anchors.push(literal.value);
  }
  if (/(身份证|身份證)/u.test(text)) anchors.push("身份证");
  if (/(护照|護照)/u.test(text)) anchors.push("护照");
  if (/银行对账单|銀行對帳單/u.test(text)) anchors.push("银行对账单");
  return [...new Set(anchors.map((anchor) => anchor.trim()).filter(Boolean))];
}

export function extractGeneralContentAnchors(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 18);
  const general: string[] = [];
  for (const line of lines) {
    if (/^[一二三四五六七八九十]+、/u.test(line)) continue;
    if (extractCriticalFactAnchors(line).length > 0) continue;
    general.push(line);
  }
  return [...new Set(general)];
}

/** @deprecated Prefer extractCriticalFactAnchors for organizer policy. */
export function extractHighValueFactAnchors(text: string): string[] {
  return extractCriticalFactAnchors(text);
}

export function highValueAnchorsMissingFromOutput(
  sourceText: string,
  outputText: string,
): string[] {
  const anchors = extractCriticalFactAnchors(sourceText);
  if (anchors.length === 0) return [];
  return anchors.filter((anchor) => !organizerOutputContainsFact(outputText, anchor));
}

export function criticalFactAnchorsMissingFromOutput(
  sourceText: string,
  outputText: string,
): string[] {
  return highValueAnchorsMissingFromOutput(sourceText, outputText);
}

export function generalContentAnchorsMissingFromOutput(
  sourceText: string,
  outputText: string,
): string[] {
  const anchors = extractGeneralContentAnchors(sourceText);
  return anchors.filter((anchor) => !generalContentPresentInOutput(outputText, anchor));
}

function generalContentPresentInOutput(outputText: string, segment: string): boolean {
  const normalizedOutput = normalizeKnowledgeSourceText(outputText);
  const normalizedSegment = normalizeKnowledgeSourceText(segment);
  if (normalizedOutput.includes(normalizedSegment)) return true;
  const words = normalizedSegment
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4);
  if (words.length === 0) {
    return normalizedOutput.includes(normalizedSegment.slice(0, 12));
  }
  const matched = words.filter((word) => normalizedOutput.includes(word)).length;
  return matched / words.length >= 0.5;
}
