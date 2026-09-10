export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { KnowledgeLocalizedPageIntro } from "@/components/knowledge/knowledge-localized-page-intro";
import { KnowledgeBackLinkLocalized } from "@/components/knowledge/knowledge-back-link-localized";
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
      <KnowledgeLocalizedPageIntro
        titleKey="knowledge.review.pageTitle"
        descriptionKey="knowledge.review.centerDescription"
        action={
          <KnowledgeBackLinkLocalized
            href="/knowledge"
            labelKey="knowledge.article.backToKnowledge"
          />
        }
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
