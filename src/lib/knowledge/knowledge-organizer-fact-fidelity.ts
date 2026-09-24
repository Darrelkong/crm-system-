import type { KnowledgeAiOrganizationOutput } from "@/lib/knowledge/ai-organizer-schema";
import { normalizeForKnowledgeFactComparison } from "@/lib/knowledge/knowledge-chinese-script";
import {
  criticalFactAnchorsMissingFromOutput,
  extractCriticalFactAnchors,
  organizerOutputContainsFact,
} from "@/lib/knowledge/knowledge-extraction-usability";

export const ORGANIZER_UNSUPPORTED_DETAIL_WARNING_PREFIX =
  "整理结果包含来源未支持的具体要求：";

export type OrganizerFactFidelityResult = {
  ok: boolean;
  droppedCriticalAnchors: string[];
  unsupportedQualifiers: string[];
  unsupportedNumbers: string[];
  requiresHumanReview: boolean;
  warnings: string[];
};

const HIGH_RISK_REQUIREMENT_TERMS = [
  "扫描件",
  "掃描件",
  "四角清晰",
  "四角",
  "1:1",
  "相关页面",
  "相關頁面",
  "复印件",
  "複印件",
  "彩色",
  "原件",
  "公证",
  "公證",
  "认证",
  "認證",
] as const;

function collectNumericTokens(text: string): string[] {
  const tokens: string[] = [];
  const patterns = [
    /\d{1,3}(?:,\d{3})+/gu,
    /\d+(?:\.\d+)?\s*(?:万|萬)\s*(?:美元|美金|港币|港幣)?/giu,
    /\d+\s*[wW](?:\s*(?:美金|美元))?/giu,
    /\d+\s*(?:天|日)(?:\s*内|\s*內)?/giu,
    /\d+(?:\.\d+)?\s*%/gu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[0]?.trim()) tokens.push(match[0].trim());
    }
  }
  return [...new Set(tokens)];
}

function numericTokenSupportedInSource(token: string, sourceNorm: string): boolean {
  const tokenNorm = normalizeForKnowledgeFactComparison(token);
  if (!tokenNorm) return true;
  if (sourceNorm.includes(tokenNorm)) return true;
  const digits = token.match(/\d+/g);
  if (!digits?.length) return sourceNorm.includes(tokenNorm);
  return digits.every((digit) => sourceNorm.includes(digit));
}

function extractParentheticalSegments(text: string): string[] {
  const segments: string[] = [];
  for (const match of text.matchAll(/[（(]([^）)]+)[）)]/gu)) {
    const inner = match[1]?.trim();
    if (inner) segments.push(inner);
  }
  return segments;
}

function splitQualifierClauses(segment: string): string[] {
  return segment
    .split(/[/／、,，;；]/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function qualifierClauseSupported(
  clause: string,
  sourceText: string,
  sourceNorm: string,
): boolean {
  const clauseNorm = normalizeForKnowledgeFactComparison(clause);
  if (!clauseNorm) return true;
  if (sourceNorm.includes(clauseNorm)) return true;
  if (organizerOutputContainsFact(sourceText, clause)) return true;
  if (/正反面/u.test(clause) && /正反面/u.test(sourceText)) return true;
  if (/反面/u.test(clause) && /反面/u.test(sourceText)) return true;
  return false;
}

function extractUnsupportedQualifiers(
  sourceText: string,
  generatedText: string,
): string[] {
  const sourceNorm = normalizeForKnowledgeFactComparison(sourceText);
  const unsupported: string[] = [];
  for (const segment of extractParentheticalSegments(generatedText)) {
    for (const clause of splitQualifierClauses(segment)) {
      if (!qualifierClauseSupported(clause, sourceText, sourceNorm)) {
        unsupported.push(clause);
      }
    }
  }
  for (const term of HIGH_RISK_REQUIREMENT_TERMS) {
    if (generatedText.includes(term) && !sourceContainsTermLoose(sourceText, term)) {
      unsupported.push(term);
    }
  }
  return [...new Set(unsupported)];
}

function sourceContainsTermLoose(sourceText: string, term: string): boolean {
  const sourceNorm = normalizeForKnowledgeFactComparison(sourceText);
  const termNorm = normalizeForKnowledgeFactComparison(term);
  return Boolean(termNorm && sourceNorm.includes(termNorm));
}

function extractUnsupportedNumbers(sourceText: string, generatedText: string): string[] {
  const sourceNorm = normalizeForKnowledgeFactComparison(sourceText);
  const generatedNumbers = collectNumericTokens(generatedText);
  return generatedNumbers.filter(
    (token) => !numericTokenSupportedInSource(token, sourceNorm),
  );
}

export function assessOrganizerFactFidelity(
  sourceText: string,
  output: Pick<KnowledgeAiOrganizationOutput, "title" | "summary" | "body">,
): OrganizerFactFidelityResult {
  const source = sourceText.trim();
  const generated = [output.title, output.summary ?? "", output.body].join("\n");
  const droppedCriticalAnchors = criticalFactAnchorsMissingFromOutput(source, generated);
  const unsupportedQualifiers = extractUnsupportedQualifiers(source, generated);
  const unsupportedNumbers = extractUnsupportedNumbers(source, generated);

  const warnings: string[] = [];
  if (unsupportedQualifiers.length > 0) {
    warnings.push(
      `${ORGANIZER_UNSUPPORTED_DETAIL_WARNING_PREFIX}${unsupportedQualifiers.join("、")}`,
    );
  }
  for (const anchor of droppedCriticalAnchors) {
    warnings.push(`缺少重要事实：${anchor}`);
  }
  for (const number of unsupportedNumbers) {
    warnings.push(`整理结果包含来源未支持的数值：${number}`);
  }

  const ok =
    unsupportedQualifiers.length === 0 &&
    unsupportedNumbers.length === 0 &&
    droppedCriticalAnchors.length === 0;

  return {
    ok,
    droppedCriticalAnchors,
    unsupportedQualifiers,
    unsupportedNumbers,
    requiresHumanReview: !ok,
    warnings,
  };
}

export function validateOrganizerFactFidelity(
  sourceText: string,
  output: KnowledgeAiOrganizationOutput,
): OrganizerFactFidelityResult {
  return assessOrganizerFactFidelity(sourceText, output);
}

/** Lightweight check for summary/title introducing facts absent from source evidence. */
export function assessOrganizerFieldFactFidelity(
  sourceText: string,
  fieldText: string,
): { ok: boolean; unsupportedQualifiers: string[] } {
  const unsupportedQualifiers = extractUnsupportedQualifiers(sourceText, fieldText);
  const unsupportedNumbers = extractUnsupportedNumbers(sourceText, fieldText);
  return {
    ok: unsupportedQualifiers.length === 0 && unsupportedNumbers.length === 0,
    unsupportedQualifiers: [...unsupportedQualifiers, ...unsupportedNumbers],
  };
}

export function buildEvidenceGroundedSummaryFromAnchors(input: {
  title: string;
  body: string;
  sourceEvidence: string;
}): string | null {
  const title = input.title.trim();
  const brand = title.split(/\s+/).slice(0, 3).join(" ").trim() || title;
  const generated = [input.title, input.body].join("\n");
  const anchors = extractCriticalFactAnchors(input.sourceEvidence).filter((anchor) =>
    organizerOutputContainsFact(generated, anchor),
  );
  if (anchors.length === 0) return null;

  const docAnchors = anchors.filter((anchor) =>
    /身份证|护照|银行对账单|KYC/i.test(anchor),
  );
  const limitAnchors = anchors.filter((anchor) =>
    /ACH|Zelle|美元|美金|万|W/i.test(anchor),
  );

  const parts: string[] = [];
  if (docAnchors.length > 0) {
    parts.push(`需提供${docAnchors.slice(0, 4).join("、")}等材料`);
  }
  if (limitAnchors.length > 0) {
    parts.push(`并涉及${limitAnchors.slice(0, 4).join("、")}等交易额度要求`);
  }
  if (parts.length === 0) {
    parts.push(`涵盖${anchors.slice(0, 5).join("、")}等要点`);
  }
  return `${brand}开户${parts.join("，")}，具体细节以正文为准。`.slice(0, 160);
}
