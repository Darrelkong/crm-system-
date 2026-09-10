import { redirect } from "next/navigation";
import { KnowledgeAccessPageContent } from "@/components/knowledge/knowledge-access-page-content";
import { KnowledgeLocalizedPageIntro } from "@/components/knowledge/knowledge-localized-page-intro";
import { getKnowledgeSessionStatus } from "@/lib/permissions/knowledge";

export default async function KnowledgeAccessPage() {
  const status = await getKnowledgeSessionStatus();
  if (status.access.unlocked) {
    redirect("/knowledge");
  }

  return (
    <div>
      <KnowledgeLocalizedPageIntro
        titleKey="knowledge.accessTitle"
        descriptionKey="knowledge.accessDescription"
      />
      <KnowledgeAccessPageContent initialized={status.access.initialized} />
    </div>
  );
}
