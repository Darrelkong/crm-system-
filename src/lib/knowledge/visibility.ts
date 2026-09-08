import type { KnowledgeRole } from "../../../drizzle/schema/knowledge-user-roles";
import type { KnowledgeVisibility } from "@/lib/knowledge/constants";

export function canViewKnowledgeVisibility(input: {
  role: KnowledgeRole;
  visibility: KnowledgeVisibility;
  userId: string;
  ownerId?: string | null;
  hasRestrictedGrant?: boolean;
}): boolean {
  if (input.role === "knowledge_admin") {
    return true;
  }
  if (input.visibility === "team") {
    return true;
  }
  if (input.visibility === "restricted") {
    return input.hasRestrictedGrant === true;
  }
  return input.ownerId === input.userId;
}
