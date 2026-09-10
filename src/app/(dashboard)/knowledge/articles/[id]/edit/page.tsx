export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { KnowledgeLocalizedPageIntro } from "@/components/knowledge/knowledge-localized-page-intro";
import { KnowledgeBackLinkLocalized } from "@/components/knowledge/knowledge-back-link-localized";
import { KnowledgeArticleEditor } from "@/components/knowledge/knowledge-article-editor";
import {
  getKnowledgeArticle,
  listKnowledgeCategories,
} from "@/lib/knowledge/core-service";
import { canEditKnowledgeArticle } from "@/lib/knowledge/article-permissions";
import { getDb } from "@/lib/db";
import { hasActiveKnowledgeReview } from "@/lib/knowledge/review-state";
import { requireKnowledgeAccess } from "@/lib/permissions/knowledge";

type PageContext = { params: Promise<{ id: string }> };

export default async function EditKnowledgeArticlePage(context: PageContext) {
  const { id } = await context.params;
  const actor = await requireKnowledgeAccess();
  const article = await getKnowledgeArticle(actor, id).catch(() => null);
  if (!article) notFound();
  if (
    article.isPublishedSnapshot ||
    (await hasActiveKnowledgeReview(id, getDb()))
  ) {
    redirect(`/knowledge/articles/${id}`);
  }
  if (!canEditKnowledgeArticle(actor, article)) {
    redirect(`/knowledge/articles/${id}`);
  }
  return (
    <div>
      <KnowledgeLocalizedPageIntro
        titleKey="knowledge.article.editTitle"
        descriptionKey="knowledge.article.editDescription"
        action={
          <KnowledgeBackLinkLocalized
            href={`/knowledge/articles/${id}`}
            labelKey="knowledge.article.backToArticle"
          />
        }
      />
      <KnowledgeArticleEditor
        article={article}
        categories={await listKnowledgeCategories()}
        role={actor.role}
      />
    </div>
  );
}
