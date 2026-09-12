export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { KnowledgeLocalizedPageIntro } from "@/components/knowledge/knowledge-localized-page-intro";
import { KnowledgeBackLinkLocalized } from "@/components/knowledge/knowledge-back-link-localized";
import { KnowledgeIngestClient } from "@/components/knowledge/knowledge-ingest-client";
import { canAuthorKnowledgeArticle } from "@/lib/knowledge/article-permissions";
import { listKnowledgeCategories } from "@/lib/knowledge/core-service";
import { listKnowledgeSources } from "@/lib/knowledge/source-service";
import { isKnowledgePreviewFixturesEnabled } from "@/lib/knowledge/knowledge-preview-fixtures";
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
      <KnowledgeLocalizedPageIntro
        titleKey="knowledge.ingest.pageTitle"
        descriptionKey="knowledge.ingest.description"
        action={
          <KnowledgeBackLinkLocalized
            href="/knowledge"
            labelKey="knowledge.article.backToKnowledge"
          />
        }
      />
      <KnowledgeIngestClient
        initialCategories={await listKnowledgeCategories()}
        initialSources={await listKnowledgeSources(context, { lifecycle: "active" })}
        role={context.role}
        previewFixturesEnabled={isKnowledgePreviewFixturesEnabled()}
      />
    </div>
  );
}
