import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { isQuickEntryCustomer } from "@/lib/public-pool/quick-entry-entry-method";
import { getEffectiveSettings } from "@/lib/settings/effective";
import { upsertFirstContactTaskForClaim } from "@/lib/tasks/first-contact";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";

export const FIRST_CONTACT_REQUIRED_ERROR_CODE = "FIRST_CONTACT_REQUIRED" as const;

export type FirstContactFollowUpGateAllowed = {
  allowed: true;
};

export type FirstContactFollowUpGateBlocked = {
  allowed: false;
  reason: typeof FIRST_CONTACT_REQUIRED_ERROR_CODE;
  firstContactTaskId: string | null;
};

export type FirstContactFollowUpGateResult =
  | FirstContactFollowUpGateAllowed
  | FirstContactFollowUpGateBlocked;

/** Claim-scoped anchor for current first_contact cycle. */
export function getFirstContactClaimAnchor(customer: Customer): string | null {
  return customer.claimedAt ?? customer.poolLeftAt ?? null;
}

export async function customerHasFormalFollowUp(
  db: Database,
  customerId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.followUps.id })
    .from(schema.followUps)
    .where(eq(schema.followUps.customerId, customerId))
    .limit(1);
  return rows.length > 0;
}

async function getOpenFirstContactTaskId(
  db: Database,
  customerId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.customerId, customerId),
        eq(schema.tasks.type, "first_contact"),
        eq(schema.tasks.status, "open"),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

async function hasCompletedFirstContactForClaimCycle(
  db: Database,
  customerId: string,
  claimAnchor: string | null,
): Promise<boolean> {
  const conditions = [
    eq(schema.tasks.customerId, customerId),
    eq(schema.tasks.type, "first_contact"),
    eq(schema.tasks.status, "completed"),
    isNotNull(schema.tasks.completedAt),
  ];

  if (claimAnchor) {
    conditions.push(gte(schema.tasks.completedAt, claimAnchor));
  }

  const rows = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(and(...conditions))
    .limit(1);

  return rows.length > 0;
}

/**
 * Read-only Phase 3 gate evaluation for UI and server pre-checks.
 * Does not auto-repair missing first_contact tasks.
 */
export async function evaluateFirstContactFollowUpGate(input: {
  db: Database;
  customer: Customer;
  actor: User;
}): Promise<FirstContactFollowUpGateResult> {
  const { db, customer, actor } = input;

  if (actor.role === "admin") {
    return { allowed: true };
  }

  if (!isQuickEntryCustomer(customer)) {
    return { allowed: true };
  }

  if (customer.status === "public_pool" || customer.ownerId == null) {
    return { allowed: true };
  }

  if (await customerHasFormalFollowUp(db, customer.id)) {
    return { allowed: true };
  }

  const claimAnchor = getFirstContactClaimAnchor(customer);
  if (await hasCompletedFirstContactForClaimCycle(db, customer.id, claimAnchor)) {
    return { allowed: true };
  }

  const openTaskId = await getOpenFirstContactTaskId(db, customer.id);

  return {
    allowed: false,
    reason: FIRST_CONTACT_REQUIRED_ERROR_CODE,
    firstContactTaskId: openTaskId,
  };
}

/**
 * Server enforcement for follow-up create.
 * Auto-repairs missing current-cycle first_contact via existing upsert helper.
 */
export async function enforceFirstContactFollowUpGate(input: {
  db: Database;
  customer: Customer;
  actor: User;
  now?: string;
}): Promise<FirstContactFollowUpGateResult> {
  const result = await evaluateFirstContactFollowUpGate(input);
  if (result.allowed) {
    return result;
  }

  let firstContactTaskId = result.firstContactTaskId;
  if (!firstContactTaskId) {
    const now = input.now ?? new Date().toISOString();
    const settings = await getEffectiveSettings(input.db);
    const dueAt = new Date(
      new Date(now).getTime() + settings.firstContactSlaHours * 60 * 60 * 1000,
    ).toISOString();

    const upsert = await upsertFirstContactTaskForClaim({
      db: input.db,
      customerId: input.customer.id,
      actorId: input.actor.id,
      customerName: input.customer.customerName,
      dueAt,
      now,
    });
    firstContactTaskId = upsert.taskId;
  }

  return {
    allowed: false,
    reason: FIRST_CONTACT_REQUIRED_ERROR_CODE,
    firstContactTaskId,
  };
}

/** Count open first_contact tasks — test/diagnostic helper only. */
export async function countOpenFirstContactTasks(
  db: Database,
  customerId: string,
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.customerId, customerId),
        eq(schema.tasks.type, "first_contact"),
        eq(schema.tasks.status, "open"),
      ),
    );
  return rows[0]?.count ?? 0;
}
