import type { KnowledgeVisibility } from "@/lib/knowledge/constants";
import type { KnowledgeReviewStatus } from "../../../drizzle/schema/knowledge-review-requests";

export type KnowledgeTranslate = (
  key: string,
  params?: Record<string, string>,
) => string;

export function formatKnowledgeReviewStatus(
  status: KnowledgeReviewStatus,
  t: KnowledgeTranslate,
): string {
  return t(`knowledge.labels.reviewStatus.${status}`);
}

export function formatKnowledgeVisibility(
  visibility: KnowledgeVisibility | string,
  t: KnowledgeTranslate,
): string {
  if (
    visibility === "team" ||
    visibility === "owner" ||
    visibility === "restricted"
  ) {
    return t(`knowledge.labels.visibility.${visibility}`);
  }
  return String(visibility);
}

export function formatAssignedReviewerLabel(
  assignedReviewerName: string | null,
  t: KnowledgeTranslate,
): string {
  return assignedReviewerName ?? t("knowledge.labels.reviewerQueue");
}
