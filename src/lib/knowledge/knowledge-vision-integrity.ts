import type {
  KnowledgeVisionExtractionMetadata,
  KnowledgeVisionExtractionQuality,
  KnowledgeVisionIntegrityTrace,
} from "@/lib/knowledge/vision-extraction-metadata";
import {
  isKnownHallucinationBankingTemplate,
  sourceContainsTerm,
  type KnowledgeEvidenceGroundingResult,
} from "@/lib/knowledge/knowledge-evidence-grounding";
import { assessVisionExtractionUsability } from "@/lib/knowledge/knowledge-extraction-usability";

export const VISION_INTEGRITY_WARNING_CODES = {
  GENERATIVE_VISION: "GENERATIVE_VISION",
  HIGH_RISK_FACTS: "HIGH_RISK_FACTS",
  KNOWN_HALLUCINATION_PATTERN: "KNOWN_HALLUCINATION_PATTERN",
  MODEL_QUALITY_DOWNGRADED: "MODEL_QUALITY_DOWNGRADED",
  HUMAN_REVIEW_REQUIRED: "HUMAN_REVIEW_REQUIRED",
  EXTRACTION_UNUSABLE: "EXTRACTION_UNUSABLE",
} as const;

const BANK_MARKERS = ["汇丰香港", "汇丰", "渣打", "滙豐香港", "滙豐"];
const BANK_MARKER_PATTERN = /\bHSBC\b/i;
const JURISDICTION_MARKERS = ["土耳其", "Turkey", "香港公司註冊", "Certificate of Incorporation"];
const AMOUNT_PATTERN =
  /(?:HKD|USD|港币|港幣|美元|人民币|人民幣|¥|￥)\s*[\d,]+|\d+[\s,]*(?:万|萬)(?:\s*(?:港币|港幣|美元))?/iu;
const TIME_PATTERN =
  /\d+\s*[–-]\s*\d+\s*(?:周|週|星期|个工作日|個工作日|个月|個月)/u;
const PERCENT_PATTERN = /\d+(?:\.\d+)?\s*%/u;
const DATE_PATTERN =
  /\d{4}\s*年\s*\d{1,2}\s*月|\d{4}-\d{2}-\d{2}/u;

export type KnowledgeVisionIntegrityAssessment = KnowledgeEvidenceGroundingResult & {
  integrityTrace: KnowledgeVisionIntegrityTrace | null;
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function detectHighRiskVisionFacts(text: string): string[] {
  const risks: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) return risks;

  for (const marker of BANK_MARKERS) {
    if (trimmed.includes(marker)) risks.push(marker);
  }
  if (BANK_MARKER_PATTERN.test(trimmed)) risks.push("HSBC");
  for (const marker of JURISDICTION_MARKERS) {
    if (trimmed.includes(marker)) risks.push(marker);
  }
  if (AMOUNT_PATTERN.test(trimmed)) risks.push("money_amount");
  if (TIME_PATTERN.test(trimmed)) risks.push("processing_time");
  if (PERCENT_PATTERN.test(trimmed)) risks.push("percentage");
  if (DATE_PATTERN.test(trimmed)) risks.push("date");

  return unique(risks);
}

export function downgradeVisionModelQuality(
  modelReportedQuality: KnowledgeVisionExtractionQuality,
): {
  effectiveQuality: KnowledgeVisionExtractionQuality;
  downgraded: boolean;
} {
  if (modelReportedQuality === "high") {
    return { effectiveQuality: "medium", downgraded: true };
  }
  return { effectiveQuality: modelReportedQuality, downgraded: false };
}

export function isGenerativeVisionExtraction(
  extractionMethod: string | null | undefined,
): boolean {
  return extractionMethod === "vision";
}

export function assessVisionExtractionIntegrity(input: {
  rawText: string;
  extractionMetadata: KnowledgeVisionExtractionMetadata | null;
  extractionMethod: string | null;
  extractionModel: string | null;
}): KnowledgeVisionIntegrityAssessment {
  const trimmed = input.rawText.trim();
  if (!isGenerativeVisionExtraction(input.extractionMethod)) {
    return {
      ok: Boolean(trimmed),
      unsupportedTerms: [],
      requiresHumanReview: false,
      reason: trimmed ? null : "insufficient_extraction",
      integrityTrace: null,
    };
  }

  const metadata = input.extractionMetadata;
  const modelReportedQuality = metadata?.quality ?? "medium";
  const { effectiveQuality, downgraded } = downgradeVisionModelQuality(
    modelReportedQuality,
  );
  const usability = assessVisionExtractionUsability(trimmed);
  const highRiskFacts = detectHighRiskVisionFacts(trimmed);
  const reasons: string[] = [VISION_INTEGRITY_WARNING_CODES.GENERATIVE_VISION];
  if (!usability.usable) {
    reasons.push(VISION_INTEGRITY_WARNING_CODES.EXTRACTION_UNUSABLE);
  }

  if (downgraded) {
    reasons.push(VISION_INTEGRITY_WARNING_CODES.MODEL_QUALITY_DOWNGRADED);
  }
  if (highRiskFacts.length > 0) {
    reasons.push(VISION_INTEGRITY_WARNING_CODES.HIGH_RISK_FACTS);
  }
  if (isKnownHallucinationBankingTemplate(trimmed)) {
    reasons.push(VISION_INTEGRITY_WARNING_CODES.KNOWN_HALLUCINATION_PATTERN);
  }
  reasons.push(VISION_INTEGRITY_WARNING_CODES.HUMAN_REVIEW_REQUIRED);

  const unsupportedTerms: string[] = [];
  if (isKnownHallucinationBankingTemplate(trimmed)) {
    const hasTurkeyOrHkEvidence = JURISDICTION_MARKERS.some((marker) =>
      trimmed.includes(marker),
    );
    const hasHsbcEvidence = BANK_MARKERS.some((marker) =>
      sourceContainsTerm(trimmed, marker),
    );
    if (hasTurkeyOrHkEvidence && !hasHsbcEvidence) {
      unsupportedTerms.push("汇丰香港");
    }
  }

  const integrityTrace: KnowledgeVisionIntegrityTrace = {
    extractionModel: input.extractionModel,
    modelReportedQuality,
    effectiveQuality,
    requiresHumanReview: true,
    extractionUsable: usability.usable,
    reasons: unique(reasons),
    highRiskFacts,
  };

  if (!trimmed || !usability.usable) {
    return {
      ok: false,
      unsupportedTerms,
      requiresHumanReview: true,
      reason: "insufficient_extraction",
      integrityTrace,
    };
  }

  return {
    ok: true,
    unsupportedTerms,
    requiresHumanReview: true,
    reason: isKnownHallucinationBankingTemplate(trimmed)
      ? "known_template"
      : unsupportedTerms.length > 0
        ? "unsupported_claims"
        : null,
    integrityTrace,
  };
}

export function applyVisionIntegrityToMetadata(
  metadata: KnowledgeVisionExtractionMetadata,
  assessment: KnowledgeVisionIntegrityAssessment,
): KnowledgeVisionExtractionMetadata {
  if (!assessment.integrityTrace) return metadata;

  const trace = assessment.integrityTrace;
  const warningMessages: Record<string, string> = {
    [VISION_INTEGRITY_WARNING_CODES.GENERATIVE_VISION]:
      "图片文字由生成式视觉模型转录，需人工核对",
    [VISION_INTEGRITY_WARNING_CODES.MODEL_QUALITY_DOWNGRADED]:
      "模型自评质量已降级，不可作为高置信度依据",
    [VISION_INTEGRITY_WARNING_CODES.HIGH_RISK_FACTS]:
      "检测到高风险结构化事实，需人工确认",
    [VISION_INTEGRITY_WARNING_CODES.KNOWN_HALLUCINATION_PATTERN]:
      "检测到已知高风险银行模板，需人工确认",
    [VISION_INTEGRITY_WARNING_CODES.HUMAN_REVIEW_REQUIRED]: "需要人工确认",
    [VISION_INTEGRITY_WARNING_CODES.EXTRACTION_UNUSABLE]:
      "未能形成可用来源文字，请重新读取或手动补充",
  };

  const integrityWarnings = trace.reasons.map((code) => ({
    code,
    message: warningMessages[code] ?? "需要人工确认",
  }));
  const existingCodes = new Set(metadata.warnings.map((warning) => warning.code));
  const mergedWarnings = [
    ...metadata.warnings,
    ...integrityWarnings.filter((warning) => !existingCodes.has(warning.code)),
  ];

  return {
    ...metadata,
    quality: trace.effectiveQuality,
    partial: metadata.partial || trace.effectiveQuality === "low",
    warnings: mergedWarnings,
    pages: metadata.pages.map((page) => ({
      ...page,
      quality: trace.effectiveQuality,
      warnings: mergedWarnings,
    })),
    integrityTrace: trace,
  };
}

export function sourceRequiresVisionHumanReview(input: {
  extractionMethod: string | null;
  extractionMetadata: KnowledgeVisionExtractionMetadata | null;
  rawText: string | null;
}): boolean {
  if (!isGenerativeVisionExtraction(input.extractionMethod)) return false;
  const assessment = assessVisionExtractionIntegrity({
    rawText: input.rawText ?? "",
    extractionMetadata: input.extractionMetadata,
    extractionMethod: input.extractionMethod,
    extractionModel: null,
  });
  return assessment.requiresHumanReview;
}

export function visionExtractionReviewConfirmed(
  metadata: KnowledgeVisionExtractionMetadata | null,
): boolean {
  return Boolean(metadata?.humanReviewConfirmedAt);
}

export function sourceBlocksOrganizeForVisionReview(input: {
  extractionMethod: string | null;
  extractionMetadata: KnowledgeVisionExtractionMetadata | null;
  rawText: string | null;
}): boolean {
  if (
    isGenerativeVisionExtraction(input.extractionMethod) &&
    input.extractionMetadata?.integrityTrace?.extractionUsable === false
  ) {
    return true;
  }
  if (!sourceRequiresVisionHumanReview(input)) return false;
  return !visionExtractionReviewConfirmed(input.extractionMetadata);
}

export function isVisionExtractionUsable(input: {
  extractionMethod: string | null;
  extractionMetadata: KnowledgeVisionExtractionMetadata | null;
  rawText: string | null;
}): boolean {
  if (!isGenerativeVisionExtraction(input.extractionMethod)) {
    return Boolean(input.rawText?.trim());
  }
  if (input.extractionMetadata?.integrityTrace?.extractionUsable === false) {
    return false;
  }
  return assessVisionExtractionUsability(input.rawText ?? "").usable;
}
