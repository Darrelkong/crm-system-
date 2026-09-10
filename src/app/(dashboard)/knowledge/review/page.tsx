export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { PageIntro } from "@/components/ui/page-intro";
import { KnowledgeBackLink } from "@/components/knowledge/knowledge-back-link";
import { KnowledgeReviewCenterClient } from "@/components/knowledge/knowledge-review-center-client";
import { listKnowledgeUsers } from "@/lib/knowledge/role-service";
import { listKnowledgeReviewRequests } from "@/lib/knowledge/review-service";
import { requireKnowledgeAccess } from "@/lib/permissions/knowledge";

export default async function KnowledgeReviewPage() {
  const actor = await requireKnowledgeAccess();
  if (
    actor.role !== "contributor" &&
    actor.role !== "reviewer" &&
    actor.role !== "knowledge_admin"
  ) {
    redirect("/knowledge");
  }
  const [pending, mine, history, users] = await Promise.all([
    actor.role === "reviewer" || actor.role === "knowledge_admin"
      ? listKnowledgeReviewRequests(actor, "pending")
      : Promise.resolve([]),
    listKnowledgeReviewRequests(actor, "mine"),
    listKnowledgeReviewRequests(actor, "history"),
    actor.role === "knowledge_admin" ? listKnowledgeUsers() : Promise.resolve([]),
  ]);
  return (
    <div>
      <PageIntro
        title="审核中心 · Review Center"
        description="集中查看固定版本的审核内容与发布历史。审核中心不提供文章编辑。"
        action={<KnowledgeBackLink href="/knowledge">返回 Knowledge</KnowledgeBackLink>}
      />
      <KnowledgeReviewCenterClient
        initialPending={pending}
        initialMine={mine}
        initialHistory={history}
        role={actor.role}
        userId={actor.user.id}
        reviewerOptions={users}
      />
    </div>
  );
}
