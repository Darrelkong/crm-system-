export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { KnowledgeArticleDetailCard } from "@/components/knowledge/knowledge-article-detail-card";
import { KnowledgeArticlePageIntro } from "@/components/knowledge/knowledge-article-page-intro";
import { KnowledgeArticleReviewStatus } from "@/components/knowledge/knowledge-article-review-status";
import { KnowledgeReviewActions } from "@/components/knowledge/knowledge-review-actions";
import {
  canArchiveKnowledgeArticle,
  canEditKnowledgeArticle,
  canReviewInCenter,
  canShowKnowledgeArticleEditCta,
  canSubmitKnowledgeReview,
} from "@/lib/knowledge/article-permissions";
import { getKnowledgeArticle } from "@/lib/knowledge/core-service";
import {
  getArticleReviewSummaryForViewer,
  listKnowledgeArticlePublications,
} from "@/lib/knowledge/review-service";
import { requireKnowledgeAccess } from "@/lib/permissions/knowledge";

type PageContext = { params: Promise<{ id: string }> };

export default async function KnowledgeArticlePage(context: PageContext) {
  const { id } = await context.params;
  const actor = await requireKnowledgeAccess();
  const article = await getKnowledgeArticle(actor, id).catch(() => null);
  if (!article) notFound();

  const canEdit = canEditKnowledgeArticle(actor, article);
  const canSubmitReview = canSubmitKnowledgeReview(actor, article);
  const canArchive = canArchiveKnowledgeArticle(actor, article);
  const showReviewCenter = canReviewInCenter(actor.role);
  const showMyReviews = actor.role === "contributor";
  const [reviewSummary, publications] = await Promise.all([
    getArticleReviewSummaryForViewer(actor, id),
    listKnowledgeArticlePublications(actor, id).catch(() => []),
  ]);
  const canShowEdit = canShowKnowledgeArticleEditCta(canEdit, reviewSummary);
  const activeReview =
    reviewSummary?.status === "pending"
      ? {
          id: reviewSummary.id,
          submittedVersionNumber: reviewSummary.submittedVersionNumber,
          submittedByUserId: reviewSummary.submittedByUserId,
          status: "pending" as const,
        }
      : null;

  return (
    <div className="space-y-6">
      <KnowledgeArticlePageIntro
        title={article.title}
        categoryName={article.categoryName}
        updatedAt={article.updatedAt}
        articleId={article.id}
        showReviewCenter={showReviewCenter}
        showMyReviews={showMyReviews}
        canShowEdit={canShowEdit}
      />

      <KnowledgeArticleReviewStatus
        articleId={article.id}
        review={reviewSummary}
        publishedVersionNumber={article.publishedVersionNumber}
        currentVersionNumber={article.currentVersionNumber}
        hasUnpublishedChanges={article.hasUnpublishedChanges}
      />

      <KnowledgeArticleDetailCard
        article={article}
        publications={publications}
        canArchive={canArchive}
      />

      {canSubmitReview && (
        <KnowledgeReviewActions
          articleId={article.id}
          currentVersionNumber={article.currentVersionNumber}
          userId={actor.user.id}
          canSubmit={canSubmitReview}
          activeReview={activeReview}
          hasChangesRequested={reviewSummary?.status === "changes_requested"}
        />
      )}
    </div>
  );
}
