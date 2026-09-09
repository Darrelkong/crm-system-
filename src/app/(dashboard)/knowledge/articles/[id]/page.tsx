export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card } from "@/components/ui/card";
import { PageIntro } from "@/components/ui/page-intro";
import { KnowledgeReviewActions } from "@/components/knowledge/knowledge-review-actions";
import { getKnowledgeArticle } from "@/lib/knowledge/core-service";
import {
  listKnowledgeArticlePublications,
  listKnowledgeReviewRequests,
} from "@/lib/knowledge/review-service";
import { requireKnowledgeAccess } from "@/lib/permissions/knowledge";

type PageContext = { params: Promise<{ id: string }> };

export default async function KnowledgeArticlePage(context: PageContext) {
  const { id } = await context.params;
  const actor = await requireKnowledgeAccess();
  const article = await getKnowledgeArticle(actor, id).catch(() => null);
  if (!article) notFound();

  const canEdit =
    !article.isPublishedSnapshot &&
    article.status !== "archived" &&
    (actor.role === "contributor" ||
      actor.role === "reviewer" ||
      actor.role === "knowledge_admin");
  const canSubmitReview =
    !article.isPublishedSnapshot &&
    article.status !== "archived" &&
    (actor.role === "contributor" || actor.role === "knowledge_admin");
  const [myReviews, publications] = await Promise.all([
    actor.role && actor.role !== "viewer"
      ? listKnowledgeReviewRequests(actor, "mine").catch(() => [])
      : Promise.resolve([]),
    listKnowledgeArticlePublications(actor, id).catch(() => []),
  ]);
  const pendingReview = myReviews.find(
    (review) => review.articleId === id && review.status === "pending",
  );
  const activeReview = pendingReview
    ? {
        id: pendingReview.id,
        submittedVersionNumber: pendingReview.submittedVersionNumber,
        submittedByUserId: pendingReview.submittedByUserId,
        status: "pending" as const,
      }
    : null;

  return (
    <div>
      <PageIntro
        title={article.title}
        description={`${article.categoryName} · 更新于 ${new Date(article.updatedAt).toLocaleString()}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/knowledge"
              className="secondary-button inline-flex min-h-11 items-center rounded-xl px-4 py-2.5 text-sm"
            >
              返回 Knowledge
            </Link>
            <Link
              href={`/knowledge/articles/${article.id}/history`}
              className="secondary-button inline-flex min-h-11 items-center rounded-xl px-4 py-2.5 text-sm"
            >
              版本历史
            </Link>
            <Link
              href="/knowledge/review"
              className="secondary-button inline-flex min-h-11 items-center rounded-xl px-4 py-2.5 text-sm"
            >
              Review Center
            </Link>
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
      <Card className="max-w-4xl">
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
            <Badge variant="warning">目前草稿 · 未发布变更</Badge>
          )}
          <Badge variant="accent">
            {article.visibility === "team"
              ? "Team"
              : article.visibility === "owner"
                ? "Owner"
                : "Restricted"}
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
                  {publication.publishedByName} · 审核记录{" "}
                  {publication.reviewRequestId.slice(0, 8)}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
      <KnowledgeReviewActions
        articleId={article.id}
        currentVersionNumber={article.currentVersionNumber}
        userId={actor.user.id}
        canSubmit={canSubmitReview}
        activeReview={activeReview}
      />
    </div>
  );
}
