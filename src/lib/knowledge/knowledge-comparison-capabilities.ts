import { hasKnowledgeCapability } from "@/lib/knowledge/role-service";
import type { KnowledgeRole } from "../../../drizzle/schema/knowledge-user-roles";

export function canExecuteKnowledgeComparison(
  role: KnowledgeRole | null,
  userId: string,
  sourceCreatedByUserId: string | null,
): boolean {
  if (!role || !sourceCreatedByUserId) return false;
  if (role === "knowledge_admin") return true;
  if (role !== "contributor") return false;
  return sourceCreatedByUserId === userId;
}

export function canViewKnowledgeComparison(
  role: KnowledgeRole | null,
  userId: string,
  sourceCreatedByUserId: string | null,
): boolean {
  if (canExecuteKnowledgeComparison(role, userId, sourceCreatedByUserId)) {
    return true;
  }
  return role !== null && hasKnowledgeCapability(role, "review");
}
