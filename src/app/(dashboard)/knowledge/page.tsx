import { redirect } from "next/navigation";
import { PageIntro } from "@/components/ui/page-intro";
import { KnowledgeHomeClient } from "@/components/knowledge/knowledge-home-client";
import { getKnowledgeSessionStatus } from "@/lib/permissions/knowledge";
import { getKnowledgeCatalog } from "@/lib/knowledge/core-service";

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

  const catalog = await getKnowledgeCatalog(status);

  return (
    <div>
      <PageIntro
        title="Knowledge"
        description="业务知识库"
      />
      <KnowledgeHomeClient
        initialCatalog={catalog}
        role={status.role}
      />
    </div>
  );
}
