"use client";

import Link from "next/link";
import { useTranslation } from "@/i18n/provider";
import { PageIntro } from "@/components/ui/page-intro";
import { KnowledgeBackLinkLocalized } from "@/components/knowledge/knowledge-back-link-localized";

export function KnowledgeArticlePageIntro({
  title,
  categoryName,
  updatedAt,
  articleId,
  showReviewCenter,
  showMyReviews,
  canShowEdit,
}: {
  title: string;
  categoryName: string;
  updatedAt: string;
  articleId: string;
  showReviewCenter: boolean;
  showMyReviews: boolean;
  canShowEdit: boolean;
}) {
  const { t } = useTranslation();

  return (
    <PageIntro
      title={title}
      description={t("knowledge.article.metaDescription", {
        category: categoryName,
        date: new Date(updatedAt).toLocaleString(),
      })}
      action={
        <div className="flex flex-wrap gap-2">
          <KnowledgeBackLinkLocalized
            href="/knowledge"
            labelKey="knowledge.article.backToKnowledge"
          />
          <KnowledgeBackLinkLocalized
            href={`/knowledge/articles/${articleId}/history`}
            labelKey="knowledge.article.versionHistory"
          />
          {showReviewCenter && (
            <KnowledgeBackLinkLocalized
              href="/knowledge/review"
              labelKey="knowledge.article.reviewCenter"
            />
          )}
          {showMyReviews && (
            <KnowledgeBackLinkLocalized
              href="/knowledge/review"
              labelKey="knowledge.article.myReviews"
            />
          )}
          {canShowEdit && (
            <Link
              href={`/knowledge/articles/${articleId}/edit`}
              className="primary-button inline-flex min-h-11 items-center rounded-xl px-4 py-2.5 text-sm text-white"
            >
              {t("knowledge.article.editArticle")}
            </Link>
          )}
        </div>
      }
    />
  );
}
