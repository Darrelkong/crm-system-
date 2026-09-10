export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { PageIntro } from "@/components/ui/page-intro";
import { KnowledgeArticleEditor } from "@/components/knowledge/knowledge-article-editor";
import { KnowledgeBackLink } from "@/components/knowledge/knowledge-back-link";
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
      <PageIntro
        title="新建 Knowledge 草稿"
        description="建立一篇纯文字文章草稿，保存后可提交审核。"
        action={<KnowledgeBackLink href="/knowledge">返回 Knowledge</KnowledgeBackLink>}
      />
      <KnowledgeArticleEditor
        article={null}
        categories={await listKnowledgeCategories()}
        role={context.role}
      />
    </div>
  );
}
