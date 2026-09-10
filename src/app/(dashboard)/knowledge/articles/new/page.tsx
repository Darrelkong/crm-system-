export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { KnowledgeLocalizedPageIntro } from "@/components/knowledge/knowledge-localized-page-intro";
import { KnowledgeBackLinkLocalized } from "@/components/knowledge/knowledge-back-link-localized";
import { KnowledgeArticleEditor } from "@/components/knowledge/knowledge-article-editor";
import { canAuthorKnowledgeArticle } from "@/lib/knowledge/article-permissions";
import { listKnowledgeCategories } from "@/lib/knowledge/core-service";
import { requireKnowledgeAccess } from "@/lib/permissions/knowledge";

export default async function NewKnowledgeArticlePage() {
  const context = await requireKnowledgeAccess();
  if (!canAuthorKnowledgeArticle(context.role)) {
    redirect("/knowledge");
  }
  return (
    <div>
      <KnowledgeLocalizedPageIntro
        titleKey="knowledge.article.newTitle"
        descriptionKey="knowledge.article.newDescription"
        action={
          <KnowledgeBackLinkLocalized
            href="/knowledge"
            labelKey="knowledge.article.backToKnowledge"
          />
        }
      />
      <KnowledgeArticleEditor
        article={null}
        categories={await listKnowledgeCategories()}
        role={context.role}
      />
    </div>
  );
}
