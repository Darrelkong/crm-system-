import type { KnowledgeAiOrganizationOutput } from "@/lib/knowledge/ai-organizer-schema";
import {
  canonicalizeKnowledgeArticleText,
  normalizeForKnowledgeFactComparison,
} from "@/lib/knowledge/knowledge-chinese-script";
import {
  assessOrganizerFactFidelity,
  assessOrganizerFieldFactFidelity,
} from "@/lib/knowledge/knowledge-organizer-fact-fidelity";
import { organizerOutputContainsFact } from "@/lib/knowledge/knowledge-extraction-usability";

export const KNOWLEDGE_SUMMARY_INVALID_WARNING =
  "摘要未能形成有效的一句话概括，请人工确认。";

const GENERIC_ORGANIZER_WARNING_PATTERNS = [
  /^資訊不足\s*\/\s*需要人工補充$/u,
  /^信息不足\s*\/\s*需要人工补充$/u,
  /^資訊不足$/u,
  /^信息不足$/u,
];

const GENERIC_SUMMARY_META_PATTERNS = [
  /涵盖[^。]{0,40}等要点/u,
  /具体内容以正文为准/u,
  /具体细节以正文为准/u,
  /具体条件与限额以正文为准/u,
  /具体材料、激活资金与交易额度以正文为准/u,
  /详情请参阅正文/u,
  /相关要求请参阅正文/u,
  /本文主要介绍/u,
  /本文涵盖/u,
  /开户与运营要求涵盖/u,
  /已整理为知识条目/u,
  /相关内容涵盖[^。]{0,40}等事项/u,
];

export type KnowledgeSummaryValidation = {
  valid: boolean;
  reasons: string[];
};

function normalizedComparable(value: string): string {
  return normalizeForKnowledgeFactComparison(value);
}

export function isGenericOrganizerWarning(message: string): boolean {
  const trimmed = message.trim();
  return GENERIC_ORGANIZER_WARNING_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function isGenericKnowledgeSummaryMeta(summary: string): boolean {
  const trimmed = summary.trim();
  if (!trimmed) return true;
  return GENERIC_SUMMARY_META_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function sanitizeOrganizerWarnings(warnings: string[]): string[] {
  const specific = warnings
    .map((warning) => warning.trim())
    .filter(Boolean)
    .filter((warning) => !isGenericOrganizerWarning(warning));
  return [...new Set(specific)];
}

export function validateKnowledgeArticleSummary(input: {
  summary: string | null;
  title: string;
  body: string;
  sourceEvidence?: string | null;
}): KnowledgeSummaryValidation {
  const reasons: string[] = [];
  const summary = input.summary?.trim() ?? "";
  if (!summary) {
    reasons.push("empty");
    return { valid: false, reasons };
  }
  if (summary.includes("\n")) {
    reasons.push("multiline");
  }
  if (/^\d+[.、．)\s]/u.test(summary)) {
    reasons.push("numbered_list");
  }
  if (/^[-*#]\s/u.test(summary)) {
    reasons.push("bullet_marker");
  }
  if (/^[一二三四五六七八九十]+、/u.test(summary)) {
    reasons.push("section_heading");
  }
  if (/^[^\n]{0,40}[：:]\s*$/u.test(summary)) {
    reasons.push("heading_only");
  }
  const titleNorm = normalizedComparable(input.title);
  const summaryNorm = normalizedComparable(summary);
  if (summaryNorm && titleNorm && summaryNorm === titleNorm) {
    reasons.push("title_only");
  }
  const bodyNorm = normalizedComparable(input.body);
  if (
    bodyNorm.startsWith(summaryNorm) &&
    summaryNorm.length >= Math.min(24, bodyNorm.length * 0.35)
  ) {
    reasons.push("body_prefix");
  }
  const evidenceNorm = input.sourceEvidence
    ? normalizedComparable(input.sourceEvidence)
    : "";
  if (
    evidenceNorm &&
    evidenceNorm.startsWith(summaryNorm) &&
    summaryNorm.length >= Math.min(24, evidenceNorm.length * 0.35)
  ) {
    reasons.push("source_prefix");
  }
  if (summary.length > 160) {
    reasons.push("excessive_length");
  }
  if (isGenericKnowledgeSummaryMeta(summary)) {
    reasons.push("generic_meta");
  }
  return { valid: reasons.length === 0, reasons };
}

function extractStructuredBodyListItems(body: string): string[] {
  const items: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^\s*\d+[.、．)]\s*(.+)$/u);
    if (match?.[1]?.trim()) {
      items.push(match[1].trim());
    }
  }
  return items;
}

function isLimitListItem(text: string): boolean {
  return /ACH|Zelle|电汇|额度|限额|转账|每日|每月|日额/u.test(text);
}

function compactSummaryListItem(text: string): string {
  return text
    .replace(/\s+/g, "")
    .replace(/[：:]\s*/gu, "")
    .trim();
}

function summaryPhraseSupportedInBody(phrase: string, body: string): boolean {
  return organizerOutputContainsFact(body, phrase);
}

function formatLimitSummaryPhrase(text: string): string {
  const compact = compactSummaryListItem(text);
  if (/ACH/u.test(compact)) {
    const amount = compact.match(/\d+(?:,\d{3})*(?:\.\d+)?(?:万|萬)?(?:美元|美金)?/u)?.[0];
    return amount ? `ACH日额度${amount}` : "ACH";
  }
  if (/Zelle/u.test(compact)) {
    const amount = compact.match(/\d{1,3}(?:,\d{3})+/u)?.[0];
    return amount ? `Zelle每日上限${amount}美元` : "Zelle";
  }
  if (/电汇/u.test(compact)) {
    const amount = compact.match(/\d+(?:,\d{3})*(?:\.\d+)?(?:万|萬)?(?:美元|美金)?/u)?.[0];
    return amount ? `在线电汇日额度${amount}` : "在线电汇";
  }
  return compact.slice(0, 28);
}

function formatDocumentSummaryPhrase(text: string): string {
  const compact = compactSummaryListItem(text);
  if (/身份证|身份證/u.test(compact) && /正反面|反面/u.test(compact)) {
    return "身份证正反面";
  }
  if (/护照|護照/u.test(compact)) {
    return compact.includes("有效") ? "有效护照" : "护照";
  }
  if (/银行对账单|銀行對帳單|对账单/u.test(compact)) {
    const days = compact.match(/\d+\s*天/u)?.[0]?.replace(/\s+/g, "") ?? "";
    return days ? `${days}内美国地址银行对账单` : "美国地址银行对账单";
  }
  if (/KYC/i.test(compact)) {
    return compact.includes("个人") ? "KYC个人资料" : "KYC资料";
  }
  if (/\d+\s*[wW]/u.test(compact) || /激活/u.test(compact)) {
    const amount =
      compact.match(/\d+\s*[wW]/iu)?.[0] ??
      compact.match(/\d+(?:,\d{3})*(?:\.\d+)?(?:万|萬)?(?:美元|美金)?/u)?.[0];
    return amount ? `激活款${amount.replace(/\s+/g, "")}美元` : compact.slice(0, 24);
  }
  return compact.slice(0, 24);
}

/**
 * Builds a one-sentence summary from finalized body structure (not a body excerpt).
 */
export function buildStructuredKnowledgeSummaryFromBody(input: {
  title: string;
  body: string;
}): string | null {
  const title = canonicalizeKnowledgeArticleText(input.title).trim();
  const body = canonicalizeKnowledgeArticleText(input.body);
  const brand = title.split(/\s+/).slice(0, 3).join(" ").trim() || title;
  const listItems = extractStructuredBodyListItems(body);
  if (listItems.length === 0) {
    return null;
  }

  const docPhrases: string[] = [];
  const limitPhrases: string[] = [];
  for (const item of listItems) {
    const phrase = isLimitListItem(item)
      ? formatLimitSummaryPhrase(item)
      : formatDocumentSummaryPhrase(item);
    if (!phrase) continue;
    if (!summaryPhraseSupportedInBody(item, body)) continue;
    if (isLimitListItem(item)) {
      if (!limitPhrases.includes(phrase)) limitPhrases.push(phrase);
    } else if (!docPhrases.includes(phrase)) {
      docPhrases.push(phrase);
    }
  }

  if (docPhrases.length === 0 && limitPhrases.length === 0) {
    return null;
  }

  const segments: string[] = [];
  if (docPhrases.length > 0) {
    segments.push(`需提供${docPhrases.slice(0, 5).join("、")}`);
  }
  if (limitPhrases.length > 0) {
    const limitText = limitPhrases.slice(0, 4).join("、");
    segments.push(
      docPhrases.length > 0
        ? `并涉及${limitText}等交易额度要求`
        : `涉及${limitText}等交易额度要求`,
    );
  }
  const opener = /开户|资料|要求|账户/u.test(title) ? `${brand}开户` : brand;
  return `${opener}${segments.join("，")}。`.slice(0, 160);
}

/**
 * Builds a one-sentence summary from finalized body structure (not a body excerpt).
 */
export function buildDeterministicKnowledgeSummary(input: {
  title: string;
  body: string;
  sourceEvidence?: string | null;
}): string | null {
  const title = canonicalizeKnowledgeArticleText(input.title).trim();
  const body = canonicalizeKnowledgeArticleText(input.body);
  const sourceEvidence = input.sourceEvidence?.trim() ?? "";
  const structured = buildStructuredKnowledgeSummaryFromBody({ title, body });
  if (!structured) return null;

  const structuralCheck = validateKnowledgeArticleSummary({
    summary: structured,
    title,
    body,
    sourceEvidence: sourceEvidence || null,
  });
  if (!structuralCheck.valid) return null;

  if (sourceEvidence) {
    const fidelity = assessOrganizerFieldFactFidelity(sourceEvidence, structured);
    if (!fidelity.ok) return null;
  }

  return structured;
}

export function canonicalizeKnowledgeOrganizerOutput(
  output: KnowledgeAiOrganizationOutput,
): KnowledgeAiOrganizationOutput {
  return {
    ...output,
    title: canonicalizeKnowledgeArticleText(output.title),
    summary: output.summary
      ? canonicalizeKnowledgeArticleText(output.summary)
      : null,
    body: canonicalizeKnowledgeArticleText(output.body),
    suggestedCategory: output.suggestedCategory
      ? canonicalizeKnowledgeArticleText(output.suggestedCategory)
      : null,
    warnings: output.warnings.map((warning) =>
      canonicalizeKnowledgeArticleText(warning),
    ),
  };
}

export function finalizeKnowledgeOrganizerArticleOutput(
  output: KnowledgeAiOrganizationOutput,
  options?: { sourceEvidence?: string | null },
): KnowledgeAiOrganizationOutput {
  let next = canonicalizeKnowledgeOrganizerOutput(output);
  const warnings = sanitizeOrganizerWarnings(next.warnings);
  const sourceEvidence = options?.sourceEvidence?.trim() ?? "";

  if (sourceEvidence) {
    const fidelity = assessOrganizerFactFidelity(sourceEvidence, next);
    warnings.push(...fidelity.warnings);
  }

  const summaryCheck = validateKnowledgeArticleSummary({
    summary: next.summary,
    title: next.title,
    body: next.body,
    sourceEvidence: sourceEvidence || null,
  });
  const needsSummaryRepair =
    !summaryCheck.valid ||
    isGenericKnowledgeSummaryMeta(next.summary ?? "");
  if (needsSummaryRepair) {
    const repaired = buildDeterministicKnowledgeSummary({
      title: next.title,
      body: next.body,
      sourceEvidence: sourceEvidence || null,
    });
    const repairedCheck = repaired
      ? validateKnowledgeArticleSummary({
          summary: repaired,
          title: next.title,
          body: next.body,
          sourceEvidence: options?.sourceEvidence ?? null,
        })
      : { valid: false, reasons: ["repair_failed"] };
    if (repaired && repairedCheck.valid) {
      next = { ...next, summary: repaired };
    } else {
      warnings.unshift(KNOWLEDGE_SUMMARY_INVALID_WARNING);
      next = { ...next, summary: repaired ?? null };
    }
  }

  return { ...next, warnings: sanitizeOrganizerWarnings(warnings) };
}
