export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card } from "@/components/ui/card";
import { PageIntro } from "@/components/ui/page-intro";
import { KnowledgeArticleArchiveButton } from "@/components/knowledge/knowledge-article-archive-button";
import { KnowledgeArticleReviewStatus } from "@/components/knowledge/knowledge-article-review-status";
import { KnowledgeBackLink } from "@/components/knowledge/knowledge-back-link";
import { KnowledgeReviewActions } from "@/components/knowledge/knowledge-review-actions";
import {
  canArchiveKnowledgeArticle,
  canEditKnowledgeArticle,
  canReviewInCenter,
  canSubmitKnowledgeReview,
} from "@/lib/knowledge/article-permissions";
import { formatKnowledgeVisibility } from "@/lib/knowledge/review-labels";
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
      <PageIntro
        title={article.title}
        description={`${article.categoryName} · 更新于 ${new Date(article.updatedAt).toLocaleString()}`}
        action={
          <div className="flex flex-wrap gap-2">
            <KnowledgeBackLink href="/knowledge">返回 Knowledge</KnowledgeBackLink>
            <KnowledgeBackLink href={`/knowledge/articles/${article.id}/history`}>
              版本历史 · Version History
            </KnowledgeBackLink>
            {showReviewCenter && (
              <KnowledgeBackLink href="/knowledge/review">
                审核中心 · Review Center
              </KnowledgeBackLink>
            )}
            {showMyReviews && (
              <KnowledgeBackLink href="/knowledge/review">
                我的审核 · My Reviews
              </KnowledgeBackLink>
            )}
            {canEdit && (
              <Link
                href={`/knowledge/articles/${article.id}/edit`}
                className="primary-button inline-flex min-h-11 items-center rounded-xl px-4 py-2.5 text-sm text-white"
              >
                编辑文章
              </Link>
            )}
          </div>
        }
      />

      <KnowledgeArticleReviewStatus
        articleId={article.id}
        review={reviewSummary}
        publishedVersionNumber={article.publishedVersionNumber}
        currentVersionNumber={article.currentVersionNumber}
        hasUnpublishedChanges={article.hasUnpublishedChanges}
      />

      <Card className="max-w-4xl min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={article.status === "draft" ? "warning" : "success"}>
            {article.status === "draft"
              ? "草稿"
              : article.status === "archived"
                ? "已归档"
                : "已发布"}
          </Badge>
          <Badge variant="default">版本 {article.currentVersionNumber}</Badge>
          {article.publishedVersionNumber != null && (
            <Badge variant="success">
              已发布 Version {article.publishedVersionNumber}
            </Badge>
          )}
          {article.hasUnpublishedChanges && (
            <Badge variant="warning">未发布变更</Badge>
          )}
          <Badge variant="accent">
            {formatKnowledgeVisibility(article.visibility)}
          </Badge>
        </div>
        {article.summary && (
          <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm leading-6 crm-text-secondary">
            {article.summary}
          </p>
        )}
        <article className="mt-6 whitespace-pre-wrap break-words text-sm leading-8 crm-text">
          {article.body}
        </article>
        {publications.length > 0 && (
          <div className="mt-8 border-t border-slate-200 pt-5">
            <h2 className="text-sm font-semibold crm-text">发布记录</h2>
            <div className="mt-3 space-y-2">
              {publications.map((publication) => (
                <div
                  key={publication.id}
                  className="rounded-xl bg-slate-50 px-3 py-2 text-sm crm-text-secondary"
                >
                  Version {publication.versionNumber} ·{" "}
                  {new Date(publication.publishedAt).toLocaleString()} ·{" "}
                  {publication.publishedByName}
                </div>
              ))}
            </div>
          </div>
        )}
        {canArchive && (
          <KnowledgeArticleArchiveButton
            articleId={article.id}
            updatedAt={article.updatedAt}
          />
        )}
      </Card>

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
