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

const HIGH_VALUE_ANCHOR_PATTERNS: RegExp[] = [
  /\d+\s*[wW万萬]/u,
  /\d+\s*天/u,
  /\d{1,3}(?:,\d{3})+/u,
  /\d+(?:\.\d+)?\s*%/u,
  /(?:USD|美元|美金|港币|港幣)/iu,
  /ACH/i,
  /Zelle/i,
  /KYC/i,
  /护照|護照/u,
  /身份证|身份證/u,
];

export function extractHighValueFactAnchors(text: string): string[] {
  const anchors: string[] = [];
  for (const pattern of HIGH_VALUE_ANCHOR_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[0]) anchors.push(match[0]);
  }
  const explicit = [
    "15W",
    "60 天",
    "60天",
    "10 万美元",
    "10万美元",
    "25 万美元",
    "25万美元",
    "15,000",
    "40,000",
    "Chase Private Client",
    "大通私人银行账户",
  ];
  for (const term of explicit) {
    if (text.includes(term)) anchors.push(term);
  }
  return [...new Set(anchors)];
}

export function highValueAnchorsMissingFromOutput(
  sourceText: string,
  outputText: string,
): string[] {
  const anchors = extractHighValueFactAnchors(sourceText);
  if (anchors.length === 0) return [];
  const normalizedOutput = normalizeKnowledgeSourceText(outputText).replace(/\s+/g, "");
  return anchors.filter((anchor) => {
    const compact = anchor.replace(/\s+/g, "");
    return !normalizedOutput.includes(compact);
  });
}
