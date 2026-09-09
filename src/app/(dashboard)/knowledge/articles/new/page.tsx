export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { PageIntro } from "@/components/ui/page-intro";
import { KnowledgeArticleEditor } from "@/components/knowledge/knowledge-article-editor";
import { listKnowledgeCategories } from "@/lib/knowledge/core-service";
import { requireKnowledgeAccess } from "@/lib/permissions/knowledge";

export default async function NewKnowledgeArticlePage() {
  const context = await requireKnowledgeAccess();
  if (
    context.role !== "contributor" &&
    context.role !== "reviewer" &&
    context.role !== "knowledge_admin"
  ) {
    redirect("/knowledge");
  }
  return (
    <div>
      <PageIntro
        title="新建 Knowledge 草稿"
        description="建立一篇纯文字文章草稿；Package 2 不提供发布操作。"
      />
      <KnowledgeArticleEditor
        article={null}
        categories={await listKnowledgeCategories()}
        role={context.role}
      />
    </div>
  );
}
