import type { KnowledgeCategoryAiCandidate } from "@/lib/knowledge/knowledge-category-ai-suggestion-schema";

export type KnowledgeCategoryAiSuggestionContext = {
  requestedProjectCode: string | null;
  requestedProjectLabel: string;
  title: string;
  summary: string;
  body: string;
};

const MAX_BODY_CHARS = 12_000;
const MAX_SUMMARY_CHARS = 1_000;

export function buildKnowledgeCategoryAiSuggestionSystemPrompt(): string {
  return [
    "你是知识库分类助手。",
    "你只能从用户提供的 activeCategories 列表中选择一个 categoryId。",
    "禁止发明列表之外的 categoryId，禁止返回自由文本分类名称作为权威结果。",
    "若无法安全判断，请将 categoryId 设为 null，confidenceBand 设为 low。",
    "confidenceBand 含义：",
    "high = 内容与某个现有分类高度匹配，可自动采用；",
    "medium = 有较可能分类但仍有歧义，需人工确认；",
    "low = 信息不足或歧义过大。",
    "输出 JSON：{ categoryId, confidenceBand, reason? }",
  ].join("\n");
}

export function buildKnowledgeCategoryAiSuggestionUserPrompt(input: {
  context: KnowledgeCategoryAiSuggestionContext;
  candidates: KnowledgeCategoryAiCandidate[];
}): string {
  const body = input.context.body.slice(0, MAX_BODY_CHARS);
  const summary = input.context.summary.slice(0, MAX_SUMMARY_CHARS);
  return JSON.stringify(
    {
      requestedProjectCode: input.context.requestedProjectCode,
      requestedProjectLabel: input.context.requestedProjectLabel,
      title: input.context.title,
      summary,
      body,
      activeCategories: input.candidates,
    },
    null,
    2,
  );
}
