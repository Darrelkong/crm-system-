import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { normalizeCollaboratorEmail } from "@/lib/customers/collaborator-verification";
import { assertCanSubmitApprovalRequest } from "@/lib/permissions/approvals";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";

export type VerifiedTransferTarget = {
  id: string;
  displayName: string;
  email: string;
};

/**
 * Resolves one exact, eligible Staff email without exposing directory results.
 * The result is intentionally null for every invalid or ineligible target.
 */
export async function verifyTransferTargetEmail(
  db: Database,
  input: {
    actor: User;
    customer: Customer;
    email: unknown;
  },
): Promise<VerifiedTransferTarget | null> {
  assertCanSubmitApprovalRequest(input.actor, input.customer);

  const normalized = normalizeCollaboratorEmail(input.email);
  if (!normalized) {
    return null;
  }

  const rows = await db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
      email: schema.users.email,
      isActive: schema.users.isActive,
      deletedAt: schema.users.deletedAt,
    })
    .from(schema.users)
    .where(
      and(
        sql`lower(${schema.users.email}) = ${normalized}`,
        eq(schema.users.role, "staff"),
        eq(schema.users.isActive, 1),
      ),
    )
    .limit(1);

  const target = rows[0];
  if (
    !target ||
    target.deletedAt ||
    target.id === input.actor.id ||
    target.id === input.customer.ownerId
  ) {
    return null;
  }

  return {
    id: target.id,
    displayName: target.displayName,
    email: normalized,
  };
}
