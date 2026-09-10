export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { PageIntro } from "@/components/ui/page-intro";
import { KnowledgeBackLink } from "@/components/knowledge/knowledge-back-link";
import { KnowledgeIngestClient } from "@/components/knowledge/knowledge-ingest-client";
import { canAuthorKnowledgeArticle } from "@/lib/knowledge/article-permissions";
import { listKnowledgeCategories } from "@/lib/knowledge/core-service";
import { listKnowledgeSources } from "@/lib/knowledge/source-service";
import { getKnowledgeSessionStatus } from "@/lib/permissions/knowledge";

export default async function KnowledgeIngestPage() {
  const context = await getKnowledgeSessionStatus();
  if (!context.access.initialized) {
    redirect(
      context.user.role === "admin" ? "/knowledge/setup" : "/knowledge/access",
    );
  }
  if (!context.access.unlocked) redirect("/knowledge/access");
  if (!canAuthorKnowledgeArticle(context.role)) {
    redirect("/knowledge");
  }

  return (
    <div>
      <PageIntro
        title="资料整理 · Source Ingest"
        description="贴入文字或上传内部资料，由 AI 整理后经人工确认并保存为草稿。"
        action={<KnowledgeBackLink href="/knowledge">返回 Knowledge</KnowledgeBackLink>}
      />
      <KnowledgeIngestClient
        initialCategories={await listKnowledgeCategories()}
        initialSources={await listKnowledgeSources(context)}
        role={context.role}
      />
    </div>
  );
}
