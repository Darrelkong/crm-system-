import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";
import type { KnowledgeArticleDetail } from "@/lib/knowledge/core-service";
import type { KnowledgeRole } from "../../../drizzle/schema/knowledge-user-roles";

type ArticlePermissionFields = Pick<
  KnowledgeArticleDetail,
  "status" | "visibility" | "ownerUserId" | "isPublishedSnapshot"
>;

export function canAuthorKnowledgeArticle(
  role: KnowledgeRole | null,
): boolean {
  return role === "contributor" || role === "knowledge_admin";
}

export function canEditKnowledgeArticle(
  context: KnowledgeSessionContext,
  article: ArticlePermissionFields,
): boolean {
  if (!canAuthorKnowledgeArticle(context.role)) return false;
  if (article.isPublishedSnapshot) return false;
  if (article.status === "archived") return false;
  if (context.role === "knowledge_admin") return true;
  if (
    article.visibility === "owner" &&
    article.ownerUserId !== context.user.id
  ) {
    return false;
  }
  return article.visibility !== "restricted";
}

export function canArchiveKnowledgeArticle(
  context: KnowledgeSessionContext,
  article: Pick<ArticlePermissionFields, "status">,
): boolean {
  return context.role === "knowledge_admin" && article.status !== "archived";
}

export function canSubmitKnowledgeReview(
  context: KnowledgeSessionContext,
  article: Pick<ArticlePermissionFields, "isPublishedSnapshot" | "status">,
): boolean {
  if (!canAuthorKnowledgeArticle(context.role)) return false;
  if (article.isPublishedSnapshot || article.status === "archived") return false;
  return true;
}

export function canAccessReviewCenter(role: KnowledgeRole | null): boolean {
  return (
    role === "contributor" ||
    role === "reviewer" ||
    role === "knowledge_admin"
  );
}

export function canReviewInCenter(role: KnowledgeRole | null): boolean {
  return role === "reviewer" || role === "knowledge_admin";
}
