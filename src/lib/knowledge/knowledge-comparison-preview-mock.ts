import type { KnowledgeAiComparisonOutput } from "@/lib/knowledge/ai-comparison-schema";
import type { ComparisonCandidate } from "@/lib/knowledge/comparison-candidate-retrieval";
import { isKnowledgePreviewFixturesEnabled } from "@/lib/knowledge/knowledge-preview-fixtures";

const PREVIEW_SOURCE_MARKER = "汇丰最新资料显示最低资产要求为 100 万";
const PREVIEW_ARTICLE_TITLE = "汇丰香港测试知识";

export function shouldUseKnowledgeComparisonPreviewMock(
  organizedBody: string,
  candidates: ComparisonCandidate[],
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (!isKnowledgePreviewFixturesEnabled(env)) return false;
  if (!organizedBody.includes(PREVIEW_SOURCE_MARKER)) return false;
  return candidates.some((candidate) => candidate.title === PREVIEW_ARTICLE_TITLE);
}

export function buildKnowledgeComparisonPreviewMock(
  candidates: ComparisonCandidate[],
): KnowledgeAiComparisonOutput {
  const primary =
    candidates.find((candidate) => candidate.title === PREVIEW_ARTICLE_TITLE) ??
    candidates[0];
  return {
    relationship: primary ? "update_existing" : "new_article",
    matchedCandidateKey: (primary?.candidateKey ?? null) as
      | "C1"
      | "C2"
      | "C3"
      | null,
    matchConfidence: primary ? 0.92 : 0.2,
    newFacts: [],
    changedFacts: primary
      ? [
          {
            id: "asset-threshold",
            topic: "资产要求",
            existingValue: "最低资产 50 万",
            incomingValue: "最低资产 100 万",
            explanation:
              "金额存在明显变化，建议核实新要求的生效时间以及资料来源。",
            confidence: 0.86,
            sourceExcerpt: "最低资产要求为 100 万",
            existingExcerpt: "最低资产 50 万",
          },
        ]
      : [],
    conflicts: [],
    uncertainties: primary
      ? [
          {
            id: "effective-date",
            topic: "生效日期",
            existingValue: null,
            incomingValue: "具体生效日期需经理确认",
            explanation:
              "资料本身存在不确定性，AI 未选择单一生效日期，需要人工确认。",
            confidence: 0.62,
            sourceExcerpt: "具体生效日期需经理确认",
            existingExcerpt: null,
          },
        ]
      : [],
    suggestedUpdates: primary
      ? [
          {
            topic: "资产要求",
            suggestion:
              "确认最新资产门槛及生效日期后，再更新正式知识。",
            rationale: "新资料与当前已发布版本存在金额差异。",
            confidence: 0.84,
          },
        ]
      : [],
  };
}
