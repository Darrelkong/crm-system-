import { eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { schema, type Database } from "@/lib/db";
import { assertCanAddFollowUp, PermissionError, resolveCustomerAccessOptions } from "@/lib/permissions/customers";
import { getCustomerById } from "@/lib/customers/queries";
import type { User } from "../../../../drizzle/schema/users";
import type { CustomerRatingAction, CustomerRatingValue } from "./domain";

export function isRatingRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
}
export function isSubmissionId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export async function authorizedRatingCustomer(db: Database, id: string, user: User) {
  const customer = await getCustomerById(id);
  if (!customer) throw new PermissionError(404, "客户不存在");
  assertCanAddFollowUp(user, customer, await resolveCustomerAccessOptions(db, user, id));
  if (customer.status === "public_pool" || customer.deletedAt) throw new PermissionError(403, "该客户不能修改评级");
  return customer;
}
export async function ratingConflict(db: Database, id: string, user: User, expected: number): Promise<Response | null> {
  // Re-authorize before returning a current snapshot: ownership/status may have changed.
  const current = await authorizedRatingCustomer(db, id, user);
  if (current.customerRatingRevision === expected) return null;
  return Response.json({ errorCode: "CUSTOMER_RATING_STALE", error: "客户评级已更新，请重新确认",
    customerRating: current.customerRating, customerRatingRevision: current.customerRatingRevision }, { status: 409 });
}
export type RatingWrite = {
  eventId: string; customerId: string; followUpId: string | null; actor: User;
  rating: CustomerRatingValue; expectedRevision: number; action: CustomerRatingAction;
  reason: string | null; now: string; ipAddress: string | null; userAgent: string | null;
};
/** Must be part of the caller's ONE atomic D1 batch, never executed statement by statement. */
export function ratingStatements(db: Database, input: RatingWrite): [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] {
  const { customerId, actor, expectedRevision, eventId } = input;
  // A missing eligible CAS row yields NULL, violating history.customer_id NOT NULL.
  // This is a real transaction failure (unlike a zero-row UPDATE) and rolls back all effects.
  const guardedCustomer = sql`(SELECT id FROM customers WHERE id = ${customerId}
    AND customer_rating_revision = ${expectedRevision} AND deleted_at IS NULL
    AND status NOT IN ('public_pool', 'archived')
    AND (${actor.role === "admin" ? 1 : 0} = 1 OR (owner_id IS NOT NULL AND (owner_id = ${actor.id}
      OR EXISTS (SELECT 1 FROM customer_assignees WHERE customer_id = ${customerId} AND user_id = ${actor.id})))))`;
  const before = sql`(SELECT customer_rating FROM customers WHERE id = ${customerId})`;
  const auditAction = input.action === "follow_up_confirmed" ? "customer.rating.confirmed_follow_up"
    : input.action === "manual_clear" ? "customer.rating.cleared" : "customer.rating.corrected";
  return [
    db.insert(schema.customerRatingHistory).values({ id: eventId, customerId: guardedCustomer,
      followUpId: input.followUpId, actorUserId: actor.id, ratingBefore: before, ratingAfter: input.rating,
      action: input.action, revisionBefore: expectedRevision, revisionAfter: expectedRevision + 1,
      reason: input.reason, recordedAt: input.now }),
    db.update(schema.customers).set({ customerRating: input.rating, customerRatingRevision: expectedRevision + 1 })
      .where(eq(schema.customers.id, customerId)),
    db.insert(schema.auditLogs).values({ id: crypto.randomUUID(), userId: actor.id, action: auditAction,
      entityType: "customer", entityId: customerId, ipAddress: input.ipAddress, userAgent: input.userAgent, createdAt: input.now,
      metadata: sql`(SELECT json_object('customerId', customer_id, 'followUpId', follow_up_id,
        'ratingBefore', rating_before, 'ratingAfter', rating_after, 'revisionBefore', revision_before,
        'revisionAfter', revision_after) FROM customer_rating_history WHERE id = ${eventId})` }),
  ];
}
