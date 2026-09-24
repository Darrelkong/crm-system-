import type { KnowledgeAiOrganizationOutput } from "@/lib/knowledge/ai-organizer-schema";
import { assessOrganizerOutputCompleteness } from "@/lib/knowledge/knowledge-evidence-grounding";
import {
  buildDeterministicKnowledgeSummary,
  canonicalizeKnowledgeOrganizerOutput,
  finalizeKnowledgeOrganizerArticleOutput,
} from "@/lib/knowledge/knowledge-organizer-article-quality";
import { canonicalizeKnowledgeArticleText } from "@/lib/knowledge/knowledge-chinese-script";
import type { KnowledgeSourceDetail } from "@/lib/knowledge/source-service";

function buildMockOrganizerBody(rawText: string): string {
  return canonicalizeKnowledgeArticleText(rawText);
}

function buildMockOrganizerTitle(body: string, sourceTitle: string | null): string {
  const canonicalBody = canonicalizeKnowledgeArticleText(body);
  if (canonicalBody.includes("Chase Private Client")) {
    return "Chase Private Client 开户资料与资金流动要求";
  }
  const firstLine =
    sourceTitle?.trim() ||
    canonicalBody.split(/\r?\n/).find((line) => line.trim())?.trim() ||
    "知识来源整理";
  return canonicalizeKnowledgeArticleText(firstLine).slice(0, 200);
}

export function buildMockKnowledgeOrganizationOutput(
  source: Pick<KnowledgeSourceDetail, "sourceTitle" | "rawText">,
): KnowledgeAiOrganizationOutput {
  const rawText = source.rawText?.trim() ?? "";
  const body = buildMockOrganizerBody(rawText);
  const title = buildMockOrganizerTitle(body, source.sourceTitle);
  const summary =
    buildDeterministicKnowledgeSummary({ title, body, sourceEvidence: rawText }) ??
    null;

  const completeness = assessOrganizerOutputCompleteness(rawText, {
    title,
    summary,
    body,
    suggestedCategory: null,
    warnings: [],
  });

  const warnings = completeness.requiresHumanReview
    ? [
        ...(completeness.humanReviewWarning
          ? [completeness.humanReviewWarning]
          : []),
        ...completeness.missingCriticalAnchors.map(
          (anchor) => `缺少重要事实：${anchor}`,
        ),
        ...completeness.missingGeneralAnchors.map(
          (anchor) => `缺少说明内容：${anchor.slice(0, 80)}`,
        ),
      ]
    : [];

  return finalizeKnowledgeOrganizerArticleOutput(
    canonicalizeKnowledgeOrganizerOutput({
      title,
      summary,
      body,
      suggestedCategory: null,
      warnings,
    }),
    { sourceEvidence: rawText },
  );
}
