import { notFound } from "next/navigation";
import { KnowledgePreviewFixturesClient } from "@/components/knowledge/knowledge-preview-fixtures-client";
import { isKnowledgePreviewFixturesEnabled } from "@/lib/knowledge/knowledge-preview-fixtures";

export const dynamic = "force-dynamic";

export default function KnowledgePreviewFixturesPage() {
  if (!isKnowledgePreviewFixturesEnabled()) {
    notFound();
  }

  return <KnowledgePreviewFixturesClient />;
}
