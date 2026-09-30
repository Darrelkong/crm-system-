import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { bindTestDatabase, schema } from "@/lib/db";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getCustomerTimeline, ratingHistoryQuery } from "./service";
import type { User } from "../../../../drizzle/schema/users";
import type { NewCustomerRatingHistory } from "../../../../drizzle/schema/customer-rating-history";
const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staff = { id: SEED_IDS.staffA, role: "staff" } as User;
const recordedAt = "2026-09-27T07:00:00.000Z", oldTime = "2026-08-01T00:00:00.000Z";
let db: ReturnType<typeof drizzle<typeof schema>>, dispose: (() => Promise<void>) | undefined;
const queries: string[] = [];
before(async () => {
  process.env.CRM_ALLOW_TEST_DB_BIND = "1";
  const proxy = await getTestD1PlatformProxy<{ DB: unknown }>(); dispose = proxy.dispose;
  db = drizzle(proxy.env.DB, { schema, logger: { logQuery(query) { queries.push(query); } } }); bindTestDatabase(db);
});
after(async () => { bindTestDatabase(null); await dispose?.(); });
async function customer() {
  const id = crypto.randomUUID();
  await db.insert(schema.customers).values({ id, customerName: "Synthetic F4E", source: "other", ownerId: staff.id,
    createdBy: admin.id, createdAt: oldTime, updatedAt: oldTime, customerRating: "D", customerRatingRevision: 99 });
  return (await db.select().from(schema.customers).where(eq(schema.customers.id, id)))[0];
}
async function followUp(customerId: string, outcome = "replied") {
  const id = crypto.randomUUID();
  await db.insert(schema.followUps).values({ id, customerId, userId: staff.id, followUpTime: oldTime, channel: "phone",
    outcome, summary: "Synthetic summary", nextAction: "Synthetic next action", content: "Synthetic summary", createdAt: recordedAt });
  return id;
}
async function history(customerId: string, extra: Partial<NewCustomerRatingHistory> = {}) {
  const row: NewCustomerRatingHistory = { id: crypto.randomUUID(), customerId, actorUserId: SEED_IDS.staffB,
    action: "manual_correction", ratingBefore: "B", ratingAfter: "A", revisionBefore: 0, revisionAfter: 1,
    recordedAt, reason: "Synthetic human reason", ...extra };
  await db.insert(schema.customerRatingHistory).values(row); return row;
}
it("linked snapshots show NULL→S, B→A and A→A once, preserve next action and both clocks; audits do not duplicate", async () => {
  const c = await customer();
  for (const [before, after] of [[null, "S"], ["B", "A"], ["A", "A"]] as const) {
    const id = await followUp(c.id);
    const h = await history(c.id, { followUpId: id, action: "follow_up_confirmed", ratingBefore: before, ratingAfter: after, reason: null });
    await db.insert(schema.auditLogs).values({ id: crypto.randomUUID(), userId: staff.id, entityType: "customer", entityId: c.id,
      action: "customer.rating.confirmed_follow_up", metadata: JSON.stringify({ ratingBefore: "D", ratingAfter: "D" }), createdAt: recordedAt });
    const result = await getCustomerTimeline(db, staff, c);
    const item = result.items.find(i => i.id === `follow-up-${id}`)!;
    assert.equal(item.occurredAt, oldTime); assert.equal(item.rating?.ratingRecordedAt, recordedAt);
    assert.equal(item.rating?.ratingBefore, before); assert.equal(item.rating?.ratingAfter, after);
    assert.equal(item.nextAction, "Synthetic next action");
    assert.equal(item.rating?.eventId, h.id); assert.ok(item.rating?.actorName);
    assert.equal(result.items.filter(i => i.rating?.eventId === h.id).length, 1);
    assert.equal(result.items.some(i => String(i.metadata.action).startsWith("customer.rating.")), false);
  }
  assert.equal((await getCustomerTimeline(db, admin, c)).items.filter(i => i.rating).length, 3);
});
it("all preserve outcomes and historical follow-up without history have no fabricated rating", async () => {
  const c = await customer();
  for (const outcome of ["no_contact", "no_reply", "lost_contact", "replied"]) await followUp(c.id, outcome);
  const result = await getCustomerTimeline(db, admin, c);
  assert.equal(result.items.filter(i => i.type === "follow_up").length, 4);
  assert.equal(result.items.some(i => i.rating), false);
});
it("manual correction, manual clear and same-rating correction are standalone human decisions with reason/actor/recordedAt", async () => {
  const c = await customer();
  for (const extra of [{}, { action: "manual_clear", ratingBefore: "A", ratingAfter: null }, { ratingBefore: "A", ratingAfter: "A" }] as Partial<NewCustomerRatingHistory>[]) {
    const h = await history(c.id, extra);
    const item = (await getCustomerTimeline(db, admin, c)).items.find(i => i.id === `rating-${h.id}`)!;
    assert.equal(item.type, "rating"); assert.equal(item.occurredAt, recordedAt);
    assert.equal(item.rating?.ratingReason, "Synthetic human reason"); assert.ok(item.actorName);
    assert.equal(item.rating?.ratingAction, h.action); assert.equal(item.rating?.ratingAfter, h.ratingAfter);
  }
});
it("deleted follow-up retains its structured rating and uses recordedAt with an unavailable-link label", async () => {
  const c = await customer(), followUpId = await followUp(c.id);
  const h = await history(c.id, { action: "follow_up_confirmed", followUpId, reason: null });
  await db.delete(schema.followUps).where(eq(schema.followUps.id, followUpId));
  const item = (await getCustomerTimeline(db, admin, c)).items.find(i => i.rating?.eventId === h.id)!;
  assert.equal(item.type, "rating"); assert.equal(item.occurredAt, recordedAt); assert.equal(item.rating?.followUpUnavailable, true);
});
it("archived-basic never queries history; masked Pool and unrelated staff fail before any query; Admin retains full history", async () => {
  const c = await customer(); await history(c.id);
  queries.length = 0;
  const archived = await getCustomerTimeline(db, staff, { ...c, status: "archived" });
  assert.equal(archived.accessLevel, "archived_basic"); assert.equal(archived.items.some(i => i.rating || i.type === "rating"), false);
  assert.equal(queries.some(q => q.includes('customer_rating_history')), false);
  for (const denied of [{ ...c, status: "public_pool" as const, ownerId: null }, { ...c, ownerId: SEED_IDS.staffB }]) {
    queries.length = 0; await assert.rejects(getCustomerTimeline(db, staff, denied)); assert.equal(queries.length, 0);
  }
  assert.equal((await getCustomerTimeline(db, admin, { ...c, status: "archived" })).items.some(i => i.rating), true);
});
for (const count of [0, 10, 100]) it(`Timeline ${count} rating events: one indexed scoped query, constant query count, no N+1`, async () => {
  const c = await customer(), other = await customer(); await history(other.id);
  for (let i = 0; i < count; i++) await history(c.id, { revisionBefore: i, revisionAfter: i + 1 });
  queries.length = 0; const start = performance.now(); const result = await getCustomerTimeline(db, admin, c); const ms = performance.now() - start;
  const queryCount = queries.length;
  assert.equal(result.items.filter(i => i.type === "rating").length, count);
  assert.equal(queryCount, 8); assert.equal(queries.filter(q => q.includes('customer_rating_history')).length, 1);
  const plan = await db.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${ratingHistoryQuery(db, c.id).getSQL()}`);
  assert.ok(plan.some(p => p.detail.includes("idx_customer_rating_history_customer_recorded")));
  console.log(JSON.stringify({ ratingEvents: count, timelineMs: Math.round(ms * 100) / 100, queryCount, plan: plan.map(p => p.detail) }));
  assert.ok(ms < 3000);
});
