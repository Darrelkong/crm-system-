"use client";

import Link from "next/link";
import { useTranslation } from "@/i18n/provider";
import {
  formatAssignedReviewerLabel,
  formatKnowledgeReviewStatus,
} from "@/lib/knowledge/review-labels";
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
  const { t } = useTranslation();

  if (review?.status === "changes_requested") {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 sm:p-5">
        <p className="text-sm font-semibold text-amber-950">
          {t("knowledge.article.changesRequestedTitle")}
        </p>
        <p className="mt-2 text-sm text-amber-900">
          {t("knowledge.article.submittedVersionLine", {
            version: String(review.submittedVersionNumber),
          })}
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
          {t("knowledge.article.editRevision")}
        </Link>
      </div>
    );
  }

  if (review?.status === "pending") {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
        <p className="text-sm font-semibold text-amber-950">
          {t("knowledge.article.inReviewTitle", {
            version: String(review.submittedVersionNumber),
          })}
        </p>
        <p className="mt-2 text-sm text-amber-900">
          {formatKnowledgeReviewStatus(review.status, t)}
          {review.assignedReviewerName
            ? ` · ${review.assignedReviewerName}`
            : ` · ${formatAssignedReviewerLabel(null, t)}`}
        </p>
        <p className="mt-2 text-sm text-amber-900">
          {t("knowledge.article.withdrawFirstHint")}
        </p>
      </div>
    );
  }

  if (publishedVersionNumber != null) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
        <p className="text-sm font-semibold text-emerald-950">
          {t("knowledge.article.publishedTitle", {
            version: String(publishedVersionNumber),
          })}
        </p>
        {hasUnpublishedChanges && (
          <p className="mt-2 text-sm text-emerald-900">
            {t("knowledge.article.publishedWithDraftLine", {
              published: String(publishedVersionNumber),
              current: String(currentVersionNumber),
            })}
          </p>
        )}
      </div>
    );
  }

  return null;
}
