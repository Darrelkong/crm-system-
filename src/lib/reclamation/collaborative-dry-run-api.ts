import type { Database } from "@/lib/db";
import { AuthError } from "@/lib/permissions/auth";
import type { User } from "../../../drizzle/schema/users";
import {
  getCollaborativeDissolutionDryRun,
  type CollaborativeDissolutionDryRunResult,
} from "./collaborative-dry-run";

export async function getCollaborativeDissolutionDryRunForAdmin(
  actor: Pick<User, "role">,
  db: Database,
  options?: { now?: Date; thresholdDays?: number },
): Promise<CollaborativeDissolutionDryRunResult> {
  if (actor.role !== "admin") {
    throw new AuthError(
      403,
      "需要管理员权限",
      "permission.denied.admin_required",
    );
  }

  return getCollaborativeDissolutionDryRun(db, options);
}
