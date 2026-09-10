import Link from "next/link";
import { formatKnowledgeReviewStatus } from "@/lib/knowledge/review-labels";
import type { KnowledgeArticleReviewSummary } from "@/lib/knowledge/review-service";

export function KnowledgeArticleReviewStatus({
  articleId,
  review,
  publishedVersionNumber,
  currentVersionNumber,
  hasUnpublishedChanges,
}: {
  articleId: string;
  review: KnowledgeArticleReviewSummary | null;
  publishedVersionNumber: number | null;
  currentVersionNumber: number;
  hasUnpublishedChanges: boolean;
}) {
  if (review?.status === "changes_requested") {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 sm:p-5">
        <p className="text-sm font-semibold text-amber-950">
          审核退回 · Changes requested
        </p>
        <p className="mt-2 text-sm text-amber-900">
          提交版本 Version {review.submittedVersionNumber}
          {review.decidedAt && (
            <>
              {" "}
              · {new Date(review.decidedAt).toLocaleString()}
            </>
          )}
          {review.decidedByName && <> · {review.decidedByName}</>}
        </p>
        {review.reviewNote && (
          <p className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-white/70 p-3 text-sm text-amber-950">
            {review.reviewNote}
          </p>
        )}
        <Link
          href={`/knowledge/articles/${articleId}/edit`}
          className="primary-button mt-4 inline-flex min-h-11 items-center rounded-xl px-4 py-2.5 text-sm text-white"
        >
          编辑修订
        </Link>
      </div>
    );
  }

  if (review?.status === "pending") {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
        <p className="text-sm font-semibold text-amber-950">
          审核中 · In review · Version {review.submittedVersionNumber}
        </p>
        <p className="mt-2 text-sm text-amber-900">
          {formatKnowledgeReviewStatus(review.status)}
          {review.assignedReviewerName
            ? ` · ${review.assignedReviewerName}`
            : " · 未指定 · Reviewer Queue"}
        </p>
        <p className="mt-2 text-sm text-amber-900">
          如需修改，请先撤回审核。
        </p>
      </div>
    );
  }

  if (publishedVersionNumber != null) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
        <p className="text-sm font-semibold text-emerald-950">
          已发布 · Published · Version {publishedVersionNumber}
        </p>
        {hasUnpublishedChanges && (
          <p className="mt-2 text-sm text-emerald-900">
            已发布 Version {publishedVersionNumber} · 当前草稿 Version{" "}
            {currentVersionNumber} · 未发布变更
          </p>
        )}
      </div>
    );
  }

  return null;
}
