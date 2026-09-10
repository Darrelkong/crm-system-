import { redirect } from "next/navigation";
import { KnowledgeLocalizedPageIntro } from "@/components/knowledge/knowledge-localized-page-intro";
import { KnowledgeSetupPageContent } from "@/components/knowledge/knowledge-setup-page-content";
import { getKnowledgeSessionStatus } from "@/lib/permissions/knowledge";

export default async function KnowledgeSetupPage() {
  const status = await getKnowledgeSessionStatus();

  if (status.user.role !== "admin") {
    redirect("/knowledge/access");
  }
  if (status.access.initialized) {
    redirect(status.access.unlocked ? "/knowledge" : "/knowledge/access");
  }

  return (
    <div>
      <KnowledgeLocalizedPageIntro
        titleKey="knowledge.setupTitle"
        descriptionKey="knowledge.setupDescription"
      />
      <KnowledgeSetupPageContent />
    </div>
  );
}
