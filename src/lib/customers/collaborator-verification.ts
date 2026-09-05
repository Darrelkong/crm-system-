import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { assertCustomerCollaboratorsMutable } from "@/lib/customers/assignees-mutations";
import { listCustomerCollaborators } from "@/lib/customers/collaborators";
import { assertCanManageCustomerCollaborators } from "@/lib/permissions/customers";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";

const COMPLETE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

export type VerifiedCollaborator = {
  id: string;
  displayName: string;
  email: string;
};

export function normalizeCollaboratorEmail(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const normalized = input.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_EMAIL_LENGTH ||
    !COMPLETE_EMAIL_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

/**
 * Exact-match verification only. A null result intentionally collapses
 * malformed, missing, inactive, deleted, admin, owner, self, and already
 * assigned users into the same non-enumerating response.
 */
export async function verifyCustomerCollaboratorEmail(
  db: Database,
  input: {
    actor: User;
    customer: Customer;
    email: unknown;
  },
): Promise<VerifiedCollaborator | null> {
  assertCanManageCustomerCollaborators(input.actor, input.customer);
  await assertCustomerCollaboratorsMutable(db, input.customer.id);

  const normalized = normalizeCollaboratorEmail(input.email);
  if (!normalized) {
    return null;
  }

  const rows = await db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
      email: schema.users.email,
      role: schema.users.role,
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

  const collaborators = await listCustomerCollaborators(db, input.customer.id);
  if (collaborators.some((row) => row.userId === target.id)) {
    return null;
  }

  return {
    id: target.id,
    displayName: target.displayName,
    email: normalized,
  };
}
