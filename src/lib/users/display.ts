import type { User } from "../../../drizzle/schema/users";

export type UserSummaryForViewer = {
  id: string;
  name: string;
  /** null when a staff viewer is looking at an admin subject. */
  email: string | null;
};

/**
 * Returns a viewer-aware user summary for display purposes only.
 * Staff viewers cannot see admin email addresses.
 *
 * This helper must NOT be used for authentication, permission checks, or DB
 * writes — only for serialising API response display data.
 */
export function formatUserSummaryForViewer(
  viewer: Pick<User, "role">,
  subject: Pick<User, "id" | "role" | "displayName" | "email">,
): UserSummaryForViewer {
  const maskEmail = viewer.role === "staff" && subject.role === "admin";
  const email = maskEmail ? null : subject.email;
  const name = subject.displayName.trim() || (subject.role === "admin" ? "管理員" : "");
  return { id: subject.id, name, email };
}
