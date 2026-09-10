export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { PageIntro } from "@/components/ui/page-intro";
import { KnowledgeArticleEditor } from "@/components/knowledge/knowledge-article-editor";
import { KnowledgeBackLink } from "@/components/knowledge/knowledge-back-link";
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
      <PageIntro
        title="编辑 Knowledge 草稿"
        description="保存时会建立不可变的文章版本快照。"
        action={
          <KnowledgeBackLink href={`/knowledge/articles/${id}`}>
            返回文章
          </KnowledgeBackLink>
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
