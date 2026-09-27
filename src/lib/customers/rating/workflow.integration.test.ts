import assert from "node:assert/strict";
import { after, before, it, mock } from "node:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import { bindTestDatabase, schema } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { createCustomerFollowUp } from "@/lib/follow-ups/create-service";
import { correctCustomerRating } from "./correction-service";
import { CUSTOMER_RATINGS, RATING_REQUIRED_OUTCOMES, RATING_PRESERVE_OUTCOMES } from "./domain";
import { isValidFollowUpOutcome } from "@/lib/constants/follow-up-outcomes";
import { maskCustomerForStaff } from "@/lib/permissions/customers";
let db: ReturnType<typeof drizzle<typeof schema>>;
let admin: typeof schema.users.$inferSelect, staff: typeof admin;
const old = "2026-08-01T00:00:00.000Z";
before(async () => {
  process.env.CRM_ALLOW_TEST_DB_BIND = "1";
  const proxy = await getTestD1PlatformProxy<{ DB: unknown }>();
  db = drizzle(proxy.env.DB, { schema }); bindTestDatabase(db);
  admin = (await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.admin)))[0];
  staff = (await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.staffA)))[0];
});
after(() => bindTestDatabase(null));
async function fixture(overrides: Partial<typeof schema.customers.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  await db.insert(schema.customers).values({ id, customerName: "SYNTHETIC F4C", source: "other", ownerId: admin.id,
    createdBy: admin.id, updatedBy: admin.id, createdAt: old, updatedAt: old, status: "active",
    lastFollowUpAt: old, lastValidFollowUpAt: old, reclamationCycleStartedAt: old,
    reclaimRuleGraceUntil: "2027-01-01T00:00:00.000Z", ...overrides });
  await db.insert(schema.reclamationActionItems).values({ id: crypto.randomUUID(), userId: overrides.ownerId ?? admin.id,
    customerId: id, cycleStartedAt: old, riskEpisodeKey: id, actionState: "pending", riskBand: "routine",
    idleDays: 0, reclaimDaysSnapshot: 30, createdAt: old, updatedAt: old });
  return id;
}
const followBody = (extra: Record<string, unknown> = {}) => ({ submissionId: crypto.randomUUID(), channel: "phone",
  outcome: "contact_made", summary: "Synthetic human follow-up notes", nextAction: "Arrange the next synthetic conversation",
  nextFollowUpAt: new Date(Date.now() + 86400000 * 3).toISOString(), customerRating: "A", expectedCustomerRatingRevision: 0,
  confirmDuplicateFollowUp: true, ...extra });
const correctionBody = (extra: Record<string, unknown> = {}) => ({ submissionId: crypto.randomUUID(), rating: "S", expectedRevision: 0, reason: "Human confirmed correction", ...extra });
const request = (body: object) => new Request("http://localhost/synthetic", { method: "POST", body: JSON.stringify(body) });
const follow = (id: string, body = followBody(), actor = admin) => createCustomerFollowUp(request(body), id, actor);
const correct = (id: string, body = correctionBody(), actor = admin) => correctCustomerRating(request(body), id, actor);
async function current(id: string) { return (await db.select().from(schema.customers).where(eq(schema.customers.id, id)))[0]; }
async function snapshot(id: string) {
  const followUps = await db.select().from(schema.followUps).where(eq(schema.followUps.customerId, id));
  return { customer: await current(id), followUps,
    history: await db.select().from(schema.customerRatingHistory).where(eq(schema.customerRatingHistory.customerId, id)),
    tasks: await db.select().from(schema.tasks).where(eq(schema.tasks.customerId, id)),
    reclaim: await db.select().from(schema.reclamationActionItems).where(eq(schema.reclamationActionItems.customerId, id)),
    audits: (await db.select().from(schema.auditLogs)).filter(a =>
      (a.action.startsWith("customer.rating.") && a.entityId === id) ||
      (a.action === "follow_up.created" && followUps.some(f => f.id === a.entityId)) ||
      (a.action.startsWith("task.") && JSON.parse(a.metadata ?? "{}").customerId === id)) };
}
async function ok(response: Response, status = 201) { assert.equal(response.status, status, await response.clone().text()); return response.json(); }
async function race(a: () => Promise<Response>, b: () => Promise<Response>) {
  let arrivals = 0, release = () => {};
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const original = db.batch.bind(db);
  const stub = mock.method(db, "batch", async (...args: Parameters<typeof db.batch>) => {
    arrivals++; if (arrivals === 2) release(); if (arrivals <= 2) await barrier; return original(...args);
  });
  try { return await Promise.all([a(), b()]); } finally { stub.mock.restore(); }
}
for (const outcome of RATING_REQUIRED_OUTCOMES) {
  it(`${outcome}: missing rating/revision rejected; all four ratings accepted with independent reclaim semantics`, async () => {
    const id = await fixture(), before = await snapshot(id);
    assert.equal((await follow(id, followBody({ outcome, customerRating: undefined }))).status, 400);
    assert.equal((await follow(id, followBody({ outcome, expectedCustomerRatingRevision: undefined }))).status, 400);
    assert.deepEqual(await snapshot(id), before);
    for (const [revision, rating] of CUSTOMER_RATINGS.entries()) {
      const body = followBody({ outcome, customerRating: rating, expectedCustomerRatingRevision: revision });
      const receipt = await ok(await follow(id, body));
      assert.equal(receipt.customerRating, rating); assert.equal(receipt.customerRatingRevision, revision + 1);
      const state = await snapshot(id), event = state.history.find(e => e.followUpId === receipt.id)!;
      assert.equal(event.actorUserId, admin.id); assert.equal(event.customerId, id); assert.equal(event.reason, null);
      assert.equal(event.ratingBefore, revision === 0 ? null : CUSTOMER_RATINGS[revision - 1]);
      assert.equal(event.revisionBefore, revision); assert.equal(event.action, "follow_up_confirmed");
      assert.equal(state.followUps.at(-1)?.customerIntent, null);
      if (isValidFollowUpOutcome(outcome)) {
        assert.notEqual(state.customer.lastValidFollowUpAt, old);
        assert.notEqual(state.customer.reclamationCycleStartedAt, old);
        assert.equal(state.customer.reclaimRuleGraceUntil, null);
        assert.equal(state.reclaim[0].actionState, "completed");
      } else {
        assert.equal(state.customer.lastValidFollowUpAt, old); assert.equal(state.customer.reclamationCycleStartedAt, old);
        assert.equal(state.customer.reclaimRuleGraceUntil, before.customer.reclaimRuleGraceUntil);
        assert.equal(state.reclaim[0].actionState, "pending");
      }
    }
  });
}
for (const outcome of RATING_PRESERVE_OUTCOMES) it(`${outcome}: preserves NULL and existing A, ignores stale selector and revision`, async () => {
  for (const rating of [null, "A"] as const) {
    const id = await fixture({ customerRating: rating, customerRatingRevision: 4 });
    const receipt = await ok(await follow(id, followBody({ outcome, customerRating: rating === null ? undefined : "S", expectedCustomerRatingRevision: undefined })));
    const state = await snapshot(id);
    assert.equal(receipt.ratingEventId, null); assert.equal(receipt.customerRating, undefined);
    assert.equal(receipt.customerRatingRevision, undefined);
    assert.equal(state.customer.customerRating, rating); assert.equal(state.customer.customerRatingRevision, 4);
    assert.equal(state.history.length, 0); assert.equal(state.audits.filter(a => a.action.startsWith("customer.rating.")).length, 0);
  }
});
it("A→A is a real decision; backdated follow-up records today's confirmation; legacy intent retained without inference", async () => {
  const id = await fixture({ customerRating: "A", customerRatingRevision: 3 });
  const body = followBody({ expectedCustomerRatingRevision: 3, followUpTime: old, customerIntent: " legacy strong intent " });
  const start = new Date().toISOString(); await ok(await follow(id, body));
  const state = await snapshot(id), event = state.history[0];
  assert.equal(event.ratingBefore, "A"); assert.equal(event.ratingAfter, "A"); assert.equal(event.revisionAfter, 4);
  assert.ok(event.recordedAt >= start); assert.notEqual(event.recordedAt, old);
  assert.equal(state.followUps[0].followUpTime, old); assert.equal(state.followUps[0].customerIntent, "legacy strong intent");
});
it("different follow-up IDs race at one revision: stale loser has zero partial effects", async () => {
  const id = await fixture(), a = followBody({ customerRating: "S" }), b = followBody({ customerRating: "B" });
  const responses = await race(() => follow(id, a), () => follow(id, b));
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  const stale = await responses.find(r => r.status === 409)!.json(); assert.equal(stale.errorCode, "CUSTOMER_RATING_STALE");
  assert.equal(stale.customerRatingRevision, 1);
  const state = await snapshot(id);
  assert.equal(state.followUps.length, 1); assert.equal(state.history.length, 1); assert.equal(state.tasks.length, 1);
  assert.equal(state.customer.customerRatingRevision, 1); assert.equal(state.reclaim[0].completedFollowUpId, state.followUps[0].id);
  assert.equal(state.audits.filter(a => a.action === "follow_up.created").length, 1);
  assert.equal(state.audits.filter(a => a.action === "customer.rating.confirmed_follow_up").length, 1);
});
it("same follow-up identity concurrent replay + response loss after later revision recover original event; altered body conflicts", async () => {
  const id = await fixture(), body = followBody();
  const responses = await race(() => follow(id, body), () => follow(id, body));
  const original = await ok(responses[0]); assert.deepEqual(await ok(responses[1]), original);
  await ok(await correct(id, correctionBody({ expectedRevision: 1 })), 200);
  const before = await snapshot(id);
  assert.deepEqual(await ok(await follow(id, body)), original);
  for (const changed of [{ customerRating: "S" }, { expectedCustomerRatingRevision: 1 }, { summary: "Changed logical body" }])
    assert.equal((await follow(id, { ...body, ...changed })).status, 409);
  assert.deepEqual(await snapshot(id), before);
});
for (const target of ["history", "rating_audit", "final_audit"] as const) it(`${target} failure rolls back entire follow-up batch`, async () => {
  const id = await fixture(), body = followBody(), before = await snapshot(id);
  const table = target === "history" ? "customer_rating_history" : "audit_logs";
  const condition = target === "history" ? "1" : `NEW.action = '${target === "rating_audit" ? "customer.rating.confirmed_follow_up" : "follow_up.created"}'`;
  await db.run(sql.raw(`CREATE TRIGGER f4c_fail BEFORE INSERT ON ${table} WHEN ${condition} BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`));
  try { await assert.rejects(() => follow(id, body)); assert.deepEqual(await snapshot(id), before); }
  finally { await db.run(sql.raw("DROP TRIGGER f4c_fail")); }
  await ok(await follow(id, body));
});
it("correction, same-rating, clear: only rating/revision change; no operational effects; replay before stale", async () => {
  const id = await fixture(), initial = await snapshot(id), body = correctionBody();
  const original = await ok(await correct(id, body), 200);
  await ok(await correct(id, correctionBody({ expectedRevision: 1 })), 200);
  await ok(await correct(id, correctionBody({ rating: null, expectedRevision: 2 })), 200);
  const state = await snapshot(id);
  assert.deepEqual(state.customer, { ...initial.customer, customerRating: null, customerRatingRevision: 3 });
  assert.deepEqual(state.followUps, initial.followUps); assert.deepEqual(state.tasks, initial.tasks); assert.deepEqual(state.reclaim, initial.reclaim);
  assert.deepEqual(state.history.map(e => e.action), ["manual_correction", "manual_correction", "manual_clear"]);
  assert.equal(state.audits.length, 3); assert.equal(state.audits[2].action, "customer.rating.cleared");
  assert.deepEqual(await ok(await correct(id, body), 200), original);
  for (const change of [{ rating: "A" }, { reason: "Different correction reason" }, { expectedRevision: 2 }])
    assert.equal((await correct(id, { ...body, ...change })).status, 409);
  assert.equal((await correct(id, correctionBody({ rating: null, expectedRevision: 3 }))).status, 400);
  assert.deepEqual(await snapshot(id), state);
});
it("different correction IDs race: one event/audit/revision, no operational mutation", async () => {
  const id = await fixture(), before = await snapshot(id);
  const responses = await race(() => correct(id, correctionBody()), () => correct(id, correctionBody({ rating: "D" })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal((await responses.find(r => r.status === 409)!.json()).errorCode, "CUSTOMER_RATING_STALE");
  const state = await snapshot(id);
  assert.equal(state.history.length, 1); assert.equal(state.audits.length, 1);
  assert.deepEqual(state.customer, { ...before.customer, customerRating: state.history[0].ratingAfter, customerRatingRevision: 1 });
  assert.deepEqual(state.reclaim, before.reclaim); assert.deepEqual(state.tasks, []); assert.deepEqual(state.followUps, []);
});
it("correction same-ID concurrent replay and committed response loss have one event/audit", async () => {
  const id = await fixture(), body = correctionBody();
  const results = await race(() => correct(id, body), () => correct(id, body));
  assert.deepEqual(await ok(results[0], 200), await ok(results[1], 200));
  const second = correctionBody({ expectedRevision: 1 });
  const original = db.batch.bind(db);
  const stub = mock.method(db, "batch", async (...args: Parameters<typeof db.batch>) => { await original(...args); throw new Error("response lost"); });
  try { await ok(await correct(id, second), 200); } finally { stub.mock.restore(); }
  const state = await snapshot(id); assert.equal(state.history.length, 2); assert.equal(state.audits.length, 2);
});
it("correction final audit failure rolls back history + rating", async () => {
  const id = await fixture(), before = await snapshot(id);
  await db.run(sql.raw("CREATE TRIGGER f4c_fail BEFORE INSERT ON audit_logs WHEN NEW.action = 'customer.rating.corrected' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END"));
  try { await assert.rejects(() => correct(id)); assert.deepEqual(await snapshot(id), before); }
  finally { await db.run(sql.raw("DROP TRIGGER f4c_fail")); }
});
it("short reason, unsafe revision, invalid rating are mutation-free", async () => {
  const id = await fixture(), before = await snapshot(id);
  for (const extra of [{ reason: " no " }, { rating: "C" }, { expectedRevision: -1 }, { expectedRevision: 0.5 }, { expectedRevision: Number.MAX_SAFE_INTEGER }])
    assert.equal((await correct(id, correctionBody(extra))).status, 400);
  assert.deepEqual(await snapshot(id), before);
});
it("owner + collaborator authorized, stranger denied; public-pool admin/staff and archived writes denied; masks omit rating", async () => {
  const id = await fixture(), before = await snapshot(id);
  await assert.rejects(() => follow(id, followBody(), staff)); await assert.rejects(() => correct(id, correctionBody(), staff));
  assert.deepEqual(await snapshot(id), before);
  await db.insert(schema.customerAssignees).values({ id: crypto.randomUUID(), customerId: id, userId: staff.id, role: "collaborator", assignedAt: old, createdAt: old, updatedAt: old });
  await ok(await correct(id, correctionBody(), staff), 200);
  const owned = await fixture({ ownerId: staff.id }); await ok(await correct(owned, correctionBody(), staff), 200);
  for (const status of ["public_pool", "archived"] as const) {
    const blockedId = await fixture({ status, customerRating: "S" }), blocked = await snapshot(blockedId);
    for (const actor of [admin, staff]) {
      await assert.rejects(() => correct(blockedId, correctionBody(), actor));
      await assert.rejects(() => follow(blockedId, followBody(), actor));
    }
    assert.deepEqual(await snapshot(blockedId), blocked);
    const masked = maskCustomerForStaff(blocked.customer);
    assert.equal("customerRating" in masked, false); assert.equal("customerRatingRevision" in masked, false);
  }
});
it("permission revoked between read and commit fails SQL guard without disclosing rating", async () => {
  const id = await fixture({ ownerId: staff.id });
  const original = db.batch.bind(db);
  const stub = mock.method(db, "batch", async (...args: Parameters<typeof db.batch>) => {
    await db.update(schema.customers).set({ ownerId: admin.id }).where(eq(schema.customers.id, id)); return original(...args);
  });
  try { await assert.rejects(() => correct(id, correctionBody(), staff)); } finally { stub.mock.restore(); }
  const state = await snapshot(id); assert.equal(state.history.length, 0); assert.equal(state.audits.length, 0);
  assert.equal(state.customer.customerRatingRevision, 0);
});
it("same correction ID cannot cross customers or actors", async () => {
  const id = await fixture(), other = await fixture(), body = correctionBody(); await ok(await correct(id, body), 200);
  assert.equal((await correct(other, body)).status, 409);
  await db.insert(schema.customerAssignees).values({ id: crypto.randomUUID(), customerId: id, userId: staff.id, role: "collaborator", assignedAt: old, createdAt: old, updatedAt: old });
  assert.equal((await correct(id, body, staff)).status, 409);
});
it("follow-up and correction share the same revision gate across both write paths", async () => {
  const id = await fixture();
  const results = await race(() => follow(id), () => correct(id));
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(results.filter(r => r.status === 409).length, 1);
  const state = await snapshot(id);
  assert.equal(state.history.length, 1); assert.equal(state.customer.customerRatingRevision, 1);
  const followWon = state.history[0].action === "follow_up_confirmed";
  assert.equal(state.followUps.length, followWon ? 1 : 0); assert.equal(state.tasks.length, followWon ? 1 : 0);
});
it("assignee loses write eligibility when customer becomes unowned before commit", async () => {
  const id = await fixture();
  await db.insert(schema.customerAssignees).values({ id: crypto.randomUUID(), customerId: id, userId: staff.id,
    role: "collaborator", assignedAt: old, createdAt: old, updatedAt: old });
  const original = db.batch.bind(db);
  const stub = mock.method(db, "batch", async (...args: Parameters<typeof db.batch>) => {
    await db.update(schema.customers).set({ ownerId: null }).where(eq(schema.customers.id, id)); return original(...args);
  });
  try { await assert.rejects(() => correct(id, correctionBody(), staff)); } finally { stub.mock.restore(); }
  const state = await snapshot(id); assert.equal(state.history.length, 0); assert.equal(state.audits.length, 0);
  assert.equal(state.customer.customerRatingRevision, 0);
});
