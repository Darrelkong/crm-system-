export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { KnowledgeLocalizedPageIntro } from "@/components/knowledge/knowledge-localized-page-intro";
import { KnowledgeBackLinkLocalized } from "@/components/knowledge/knowledge-back-link-localized";
import { KnowledgeCategoriesClient } from "@/components/knowledge/knowledge-categories-client";
import { getKnowledgeCatalog } from "@/lib/knowledge/core-service";
import { getKnowledgeSessionStatus } from "@/lib/permissions/knowledge";

export default async function KnowledgeCategoriesPage() {
  const status = await getKnowledgeSessionStatus();

  if (!status.access.initialized) {
    redirect(
      status.user.role === "admin" ? "/knowledge/setup" : "/knowledge/access",
    );
  }
  if (!status.access.unlocked) {
    redirect("/knowledge/access");
  }
  if (status.role !== "knowledge_admin") {
    redirect("/knowledge");
  }

  const catalog = await getKnowledgeCatalog(status);

  return (
    <div>
      <KnowledgeLocalizedPageIntro
        titleKey="knowledge.categories.pageTitle"
        descriptionKey="knowledge.categories.description"
        action={<KnowledgeBackLinkLocalized href="/knowledge" labelKey="knowledge.categories.backToKnowledge" />}
        hideOnMobile
      />
      <KnowledgeCategoriesClient initialCategories={catalog.categories} />
    </div>
  );
}
