import type { KnowledgeAiOrganizationOutput } from "@/lib/knowledge/ai-organizer-schema";
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

/** Synthetic mobile screenshot fixture — Chase Private Client (not Turkey/HK). */
export const CHASE_PRIVATE_CLIENT_FIXTURE_TEXT = `Chase Private Client
大通私人银行账户
身份证
护照
美国地址银行对账单
KYC
激活款
ACH
wire transfer
Zelle`;

/** Synthetic fixture representing Turkey investment promo + HK incorporation (no HSBC). */
export const TURKEY_HK_INCORPORATION_FIXTURE_TEXT = `土耳其投資入籍計劃宣傳展示
最低投資金額 40 萬美元
辦理週期 3–6 個月

香港公司註冊證明書
ECHFRONT (Hong Kong) Limited
Company Number 2988776`;
