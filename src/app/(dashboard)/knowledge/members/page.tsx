export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { KnowledgeLocalizedPageIntro } from "@/components/knowledge/knowledge-localized-page-intro";
import { KnowledgeMembersBackLink } from "@/components/knowledge/knowledge-members-back-link";
import { KnowledgeMembersClient } from "@/components/knowledge/knowledge-members-client";
import { listKnowledgeUsers } from "@/lib/knowledge/role-service";
import { getKnowledgeSessionStatus } from "@/lib/permissions/knowledge";

export default async function KnowledgeMembersPage() {
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

  const members = await listKnowledgeUsers();

  return (
    <div>
      <KnowledgeLocalizedPageIntro
        titleKey="knowledge.members.pageTitle"
        descriptionKey="knowledge.members.description"
        action={<KnowledgeMembersBackLink />}
      />
      <KnowledgeMembersClient
        initialMembers={members}
        currentUserId={status.user.id}
      />
    </div>
  );
}
