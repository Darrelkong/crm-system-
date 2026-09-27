import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { blockPendingOnHoldCreateCustomer } from "@/lib/customers/pending-on-hold-api";
import { getRequestMeta } from "@/lib/auth/cookies";
import type { User } from "../../../../drizzle/schema/users";
import { isCustomerRatingValue, planManualRatingCorrection } from "./domain";
import { authorizedRatingCustomer, isRatingRevision, isSubmissionId, ratingConflict, ratingStatements } from "./persistence";

export async function correctCustomerRating(request: Request, customerId: string, actor: User): Promise<Response> {
  const db = getDb();
  await authorizedRatingCustomer(db, customerId, actor);
  const pending = await blockPendingOnHoldCreateCustomer(db, customerId);
  if (pending) return pending;
  const body = await request.json() as Record<string, unknown>;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!isSubmissionId(body.submissionId)) {
    return Response.json({ errorCode: "VALIDATION_FAILED", error: "提交标识无效" }, { status: 400 });
  }
  const eventId = body.submissionId.toLowerCase(), rating = body.rating, expectedRevision = body.expectedRevision;
  const action = rating === null ? "manual_clear" : "manual_correction";
  const recover = async (): Promise<Response | null> => {
    const event = (await db.select().from(schema.customerRatingHistory).where(eq(schema.customerRatingHistory.id, eventId)).limit(1))[0];
    if (!event) return null;
    if (event.customerId !== customerId || event.actorUserId !== actor.id || event.ratingAfter !== rating
      || event.reason !== reason || event.revisionBefore !== expectedRevision || event.action !== action || event.followUpId !== null) {
      return Response.json({ errorCode: "CUSTOMER_RATING_SUBMISSION_CONFLICT", error: "该提交已用于不同的评级决定" }, { status: 409 });
    }
    return Response.json({ ok: true, ratingEventId: event.id, customerRating: event.ratingAfter,
      customerRatingRevision: event.revisionAfter });
  };
  const canonical = await recover();
  if (canonical) return canonical;
  if (!isCustomerRatingValue(rating) || !isRatingRevision(expectedRevision) || Array.from(reason).length < 5) {
    return Response.json({ errorCode: "VALIDATION_FAILED", error: "请提供有效评级、版本和至少5个字的原因" }, { status: 400 });
  }
  const current = await authorizedRatingCustomer(db, customerId, actor);
  if (current.customerRatingRevision !== expectedRevision) {
    return (await recover()) ?? Response.json({ errorCode: "CUSTOMER_RATING_STALE", error: "客户评级已更新，请重新确认",
      customerRating: current.customerRating, customerRatingRevision: current.customerRatingRevision }, { status: 409 });
  }
  if (rating === null && current.customerRating === null) {
    return Response.json({ errorCode: "RATING_ALREADY_UNRATED", error: "客户已经未评级" }, { status: 400 });
  }
  planManualRatingCorrection({ rating: current.customerRating, revision: expectedRevision }, rating, reason, current.status);
  try {
    await db.batch(ratingStatements(db, { eventId, customerId, followUpId: null, actor, rating, expectedRevision,
      action, reason, now: new Date().toISOString(), ...getRequestMeta(request) }));
  } catch (error) {
    const committed = await recover();
    if (committed) return committed;
    const conflict = await ratingConflict(db, customerId, actor, expectedRevision);
    if (conflict) return conflict;
    throw error;
  }
  const committed = await recover();
  if (!committed) throw new Error("Rating receipt unavailable");
  return committed;
}
