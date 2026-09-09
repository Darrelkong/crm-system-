export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { PageIntro } from "@/components/ui/page-intro";
import { KnowledgeIngestClient } from "@/components/knowledge/knowledge-ingest-client";
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
  if (!context.role) redirect("/knowledge");

  return (
    <div>
      <PageIntro
        title="Knowledge source ingest"
        description="Paste or upload an internal source, organize it with AI, then save a human-reviewed draft."
      />
      <KnowledgeIngestClient
        initialCategories={await listKnowledgeCategories()}
        initialSources={await listKnowledgeSources(context)}
        role={context.role}
      />
    </div>
  );
}
