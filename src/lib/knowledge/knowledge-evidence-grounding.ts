import type { KnowledgeAiOrganizationOutput } from "@/lib/knowledge/ai-organizer-schema";
import {
  criticalFactAnchorsMissingFromOutput,
  extractGeneralContentAnchors,
  generalContentAnchorsMissingFromOutput,
  ORGANIZER_GENERAL_CONTENT_MIN_SEGMENTS,
  ORGANIZER_GENERAL_CONTENT_MISSING_RATIO,
} from "@/lib/knowledge/knowledge-extraction-usability";
import {
  assessVisionExtractionIntegrity,
  isGenerativeVisionExtraction,
} from "@/lib/knowledge/knowledge-vision-integrity";
import type { KnowledgeVisionExtractionMetadata } from "@/lib/knowledge/vision-extraction-metadata";

/** Known mock / regression banking template — must never pass as grounded evidence. */
export const KNOWN_HALLUCINATION_BANKING_TEMPLATE = `汇丰香港
最低资产要求 50 万
办理周期 4–6 周`;

const HALLUCINATION_BANKING_MARKERS = ["汇丰香港", "汇丰", "HSBC", "渣打"];

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，,。．.；;：:、]/g, "");
}

export function isKnownHallucinationBankingTemplate(text: string): boolean {
  const normalized = normalizeForMatch(text);
  const template = normalizeForMatch(KNOWN_HALLUCINATION_BANKING_TEMPLATE);
  return normalized === template || normalized.includes(normalizeForMatch("汇丰香港最低资产要求50万办理周期"));
}

export function sourceContainsTerm(sourceText: string, term: string): boolean {
  const normalizedSource = normalizeForMatch(sourceText);
  const normalizedTerm = normalizeForMatch(term);
  if (!normalizedTerm) return true;
  return normalizedSource.includes(normalizedTerm);
}

export type KnowledgeEvidenceGroundingResult = {
  ok: boolean;
  unsupportedTerms: string[];
  requiresHumanReview: boolean;
  reason: "unsupported_claims" | "insufficient_extraction" | "known_template" | null;
};

export function assessVisionExtractionReliability(input: {
  rawText: string;
  extractionMetadata: KnowledgeVisionExtractionMetadata | null;
  extractionMethod?: string | null;
  extractionModel?: string | null;
}): KnowledgeEvidenceGroundingResult {
  if (isGenerativeVisionExtraction(input.extractionMethod)) {
    const integrity = assessVisionExtractionIntegrity({
      rawText: input.rawText,
      extractionMetadata: input.extractionMetadata,
      extractionMethod: input.extractionMethod ?? null,
      extractionModel: input.extractionModel ?? null,
    });
    return {
      ok: integrity.ok,
      unsupportedTerms: integrity.unsupportedTerms,
      requiresHumanReview: integrity.requiresHumanReview,
      reason: integrity.reason,
    };
  }

  const trimmed = input.rawText.trim();
  if (!trimmed) {
    return {
      ok: false,
      unsupportedTerms: [],
      requiresHumanReview: true,
      reason: "insufficient_extraction",
    };
  }
  const metadata = input.extractionMetadata;
  if (!metadata) {
    return { ok: true, unsupportedTerms: [], requiresHumanReview: false, reason: null };
  }
  if (metadata.quality === "low" || metadata.partial) {
    return {
      ok: true,
      unsupportedTerms: [],
      requiresHumanReview: true,
      reason: "insufficient_extraction",
    };
  }
  return {
    ok: true,
    unsupportedTerms: [],
    requiresHumanReview: metadata.quality !== "high" || metadata.warnings.length > 0,
    reason: null,
  };
}

export function validateOrganizerEvidenceGrounding(
  sourceText: string,
  output: KnowledgeAiOrganizationOutput,
): KnowledgeEvidenceGroundingResult {
  const source = sourceText.trim();
  if (!source) {
    return {
      ok: false,
      unsupportedTerms: [],
      requiresHumanReview: true,
      reason: "insufficient_extraction",
    };
  }

  const generated = [output.title, output.summary ?? "", output.body].join("\n");
  if (isKnownHallucinationBankingTemplate(generated)) {
    return {
      ok: false,
      unsupportedTerms: ["汇丰香港"],
      requiresHumanReview: true,
      reason: "known_template",
    };
  }

  const unsupportedTerms: string[] = [];
  for (const marker of HALLUCINATION_BANKING_MARKERS) {
    if (generated.includes(marker) && !sourceContainsTerm(source, marker)) {
      unsupportedTerms.push(marker);
    }
  }

  const uniqueUnsupported = [...new Set(unsupportedTerms)];
  if (uniqueUnsupported.length > 0) {
    return {
      ok: false,
      unsupportedTerms: uniqueUnsupported,
      requiresHumanReview: true,
      reason: "unsupported_claims",
    };
  }

  return { ok: true, unsupportedTerms: [], requiresHumanReview: false, reason: null };
}

export const ORGANIZER_CRITICAL_FACT_HUMAN_REVIEW_WARNING =
  "检测到原始资料中的重要事实未完整保留，请人工核对。";

export type OrganizerCompletenessAssessment = {
  ok: boolean;
  requiresHumanReview: boolean;
  missingAnchors: string[];
  missingCriticalAnchors: string[];
  missingGeneralAnchors: string[];
  humanReviewWarning: string | null;
};

export function assessOrganizerOutputCompleteness(
  sourceText: string,
  output: KnowledgeAiOrganizationOutput,
): OrganizerCompletenessAssessment {
  const generated = [output.title, output.summary ?? "", output.body].join("\n");
  const missingCritical = criticalFactAnchorsMissingFromOutput(sourceText, generated);
  if (missingCritical.length > 0) {
    return {
      ok: true,
      requiresHumanReview: true,
      missingAnchors: missingCritical,
      missingCriticalAnchors: missingCritical,
      missingGeneralAnchors: [],
      humanReviewWarning: ORGANIZER_CRITICAL_FACT_HUMAN_REVIEW_WARNING,
    };
  }

  const allGeneral = extractGeneralContentAnchors(sourceText);
  const missingGeneral = generalContentAnchorsMissingFromOutput(
    sourceText,
    generated,
  );
  const missingGeneralRatio =
    allGeneral.length > 0 ? missingGeneral.length / allGeneral.length : 0;
  if (
    allGeneral.length >= ORGANIZER_GENERAL_CONTENT_MIN_SEGMENTS &&
    missingGeneralRatio >= ORGANIZER_GENERAL_CONTENT_MISSING_RATIO
  ) {
    return {
      ok: true,
      requiresHumanReview: true,
      missingAnchors: missingGeneral,
      missingCriticalAnchors: [],
      missingGeneralAnchors: missingGeneral,
      humanReviewWarning: "部分说明性内容未保留，请人工核对。",
    };
  }

  return {
    ok: true,
    requiresHumanReview: false,
    missingAnchors: [],
    missingCriticalAnchors: [],
    missingGeneralAnchors: [],
    humanReviewWarning: null,
  };
}

/** Synthetic mobile screenshot fixture — Chase Private Client (not Turkey/HK). */
export const CHASE_PRIVATE_CLIENT_FIXTURE_TEXT = `Chase Private Client
大通私人银行账户

一、资料要求

1. 身份证（正反面）
2. 护照（相关页面，四角清晰，1:1 扫描件）
3. 包含美国地址的银行对账单（60 天内）
4. KYC 个人信息填写
5. 激活款 15W 美金，下户后一个月内达到

二、资金流动限制

1. ACH 日转账额度：10 万美元
2. 在线电汇日额度：25 万美元
3. Zelle：每日上限 15,000 美元 / 每月上限 40,000 美元`;

/** Synthetic fixture representing Turkey investment promo + HK incorporation (no HSBC). */
export const TURKEY_HK_INCORPORATION_FIXTURE_TEXT = `土耳其投資入籍計劃宣傳展示
最低投資金額 40 萬美元
辦理週期 3–6 個月

香港公司註冊證明書
ECHFRONT (Hong Kong) Limited
Company Number 2988776`;
