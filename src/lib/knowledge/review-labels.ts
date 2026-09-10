import type { KnowledgeVisibility } from "@/lib/knowledge/constants";
import type { KnowledgeReviewStatus } from "../../../drizzle/schema/knowledge-review-requests";

export function formatKnowledgeReviewStatus(
  status: KnowledgeReviewStatus,
): string {
  switch (status) {
    case "pending":
      return "待审核 · Pending";
    case "changes_requested":
      return "需要修改 · Changes requested";
    case "approved":
      return "已批准 · Approved";
    case "withdrawn":
      return "已撤回 · Withdrawn";
    case "superseded":
      return "已失效 · Superseded";
    default:
      return status;
  }
}

export function formatKnowledgeVisibility(
  visibility: KnowledgeVisibility | string,
): string {
  switch (visibility) {
    case "team":
      return "团队 · Team";
    case "owner":
      return "仅本人 · Owner";
    case "restricted":
      return "受限 · Restricted";
    default:
      return String(visibility);
  }
}

export function formatAssignedReviewerLabel(
  assignedReviewerName: string | null,
): string {
  return assignedReviewerName ?? "未指定 · Reviewer Queue";
}
