export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { PageIntro } from "@/components/ui/page-intro";
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
      <PageIntro
        title="成员与角色"
        description="管理成员在 Knowledge 中的访问与操作权限"
      />
      <KnowledgeMembersClient initialMembers={members} />
    </div>
  );
}
