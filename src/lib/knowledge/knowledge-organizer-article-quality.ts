import type { KnowledgeAiOrganizationOutput } from "@/lib/knowledge/ai-organizer-schema";
import {
  canonicalizeKnowledgeArticleText,
  normalizeForKnowledgeFactComparison,
} from "@/lib/knowledge/knowledge-chinese-script";

export const KNOWLEDGE_SUMMARY_INVALID_WARNING =
  "摘要未能形成有效的一句话概括，请人工确认。";

const GENERIC_ORGANIZER_WARNING_PATTERNS = [
  /^資訊不足\s*\/\s*需要人工補充$/u,
  /^信息不足\s*\/\s*需要人工补充$/u,
  /^資訊不足$/u,
  /^信息不足$/u,
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
  return { valid: reasons.length === 0, reasons };
}

/**
 * Builds a one-sentence summary from finalized body structure (not a body excerpt).
 */
export function buildDeterministicKnowledgeSummary(input: {
  title: string;
  body: string;
}): string | null {
  const title = canonicalizeKnowledgeArticleText(input.title).trim();
  const body = canonicalizeKnowledgeArticleText(input.body);
  const sectionHeaders = [
    ...body.matchAll(/^[一二三四五六七八九十]+、\s*([^\n]+)/gmu),
  ].map((match) => match[1]?.trim() ?? "");
  const topics = sectionHeaders.filter(Boolean).slice(0, 3);
  if (topics.length === 0) {
    const compact = body.replace(/\s+/g, " ").trim();
    if (compact.length < 40) return null;
    const brand = title.split(/\s+/).slice(0, 3).join(" ");
    return `${brand}相关内容已整理为知识条目，具体条件与限额以正文为准。`.slice(
      0,
      160,
    );
  }
  const brand = title.split(/\s+/).slice(0, 3).join(" ").trim() || title;
  const topicPhrase = topics.join("、");
  if (/资料要求|資金|资金|限额|流动/u.test(body)) {
    return `${brand}开户与运营要求涵盖${topicPhrase}等要点，具体材料、激活资金与交易额度以正文为准。`.slice(
      0,
      160,
    );
  }
  return `${brand}相关内容涵盖${topicPhrase}等事项，具体细节以正文为准。`.slice(
    0,
    160,
  );
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

  const summaryCheck = validateKnowledgeArticleSummary({
    summary: next.summary,
    title: next.title,
    body: next.body,
    sourceEvidence: options?.sourceEvidence ?? null,
  });
  if (!summaryCheck.valid) {
    const repaired = buildDeterministicKnowledgeSummary({
      title: next.title,
      body: next.body,
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
