import { redirect } from "next/navigation";
import { KnowledgeLocalizedPageIntro } from "@/components/knowledge/knowledge-localized-page-intro";
import { KnowledgeHomeClient } from "@/components/knowledge/knowledge-home-client";
import { getKnowledgeSessionStatus } from "@/lib/permissions/knowledge";
export default async function KnowledgePage() {
  const status = await getKnowledgeSessionStatus();

  if (!status.access.initialized) {
    redirect(
      status.user.role === "admin" ? "/knowledge/setup" : "/knowledge/access",
    );
  }
  if (!status.access.unlocked) {
    redirect("/knowledge/access");
  }

  return (
    <div>
      <KnowledgeLocalizedPageIntro
        titleKey="knowledge.title"
        descriptionKey="knowledge.home.pageDescription"
        hideOnMobile
      />
      <KnowledgeHomeClient role={status.role} />
    </div>
  );
}
