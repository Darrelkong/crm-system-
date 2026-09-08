import type { KnowledgeRole } from "../../../drizzle/schema/knowledge-user-roles";

export const KNOWLEDGE_POLICY_ID = "singleton" as const;
export const KNOWLEDGE_MAX_FAILED_ATTEMPTS = 5;
export const KNOWLEDGE_LOCK_DURATION_MS = 15 * 60 * 1000;

export const KNOWLEDGE_ROLES = [
  "viewer",
  "contributor",
  "reviewer",
  "knowledge_admin",
] as const satisfies readonly KnowledgeRole[];

export const KNOWLEDGE_ROLE_RANK: Record<KnowledgeRole, number> = {
  viewer: 1,
  contributor: 2,
  reviewer: 3,
  knowledge_admin: 4,
};

export const KNOWLEDGE_ROLE_LABELS: Record<KnowledgeRole, string> = {
  viewer: "Viewer",
  contributor: "Contributor",
  reviewer: "Reviewer",
  knowledge_admin: "Knowledge Admin",
};

export const KNOWLEDGE_ERROR_CODES = {
  NOT_INITIALIZED: "KNOWLEDGE_NOT_INITIALIZED",
  ALREADY_INITIALIZED: "KNOWLEDGE_ALREADY_INITIALIZED",
  ACCESS_REQUIRED: "KNOWLEDGE_ACCESS_REQUIRED",
  ROLE_REQUIRED: "KNOWLEDGE_ROLE_REQUIRED",
  ADMIN_REQUIRED: "KNOWLEDGE_ADMIN_REQUIRED",
  PASSWORD_INVALID: "KNOWLEDGE_PASSWORD_INVALID",
  PASSWORD_LOCKED: "KNOWLEDGE_PASSWORD_LOCKED",
  PASSWORD_NOT_CONFIGURED: "KNOWLEDGE_PASSWORD_NOT_CONFIGURED",
  LAST_ADMIN: "KNOWLEDGE_LAST_ADMIN",
  ROLE_INVALID: "KNOWLEDGE_ROLE_INVALID",
} as const;

export type KnowledgeCapability =
  | "enter"
  | "submit"
  | "review"
  | "manage";

export const KNOWLEDGE_VISIBILITY = [
  "team",
  "restricted",
  "owner",
] as const;

export type KnowledgeVisibility = (typeof KNOWLEDGE_VISIBILITY)[number];
