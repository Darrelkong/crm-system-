import assert from "node:assert/strict";
import { before, after, it } from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import { bindTestDatabase, schema } from "@/lib/db";
import { createCustomerFollowUp } from "./create-service";
import { SEED_IDS } from "@/lib/constants/seed-ids";
let db: ReturnType<typeof drizzle<typeof schema>>;
let dispose: () => Promise<void>;
let admin: typeof schema.users.$inferSelect;
const customerId = crypto.randomUUID();
const input = { channel: "phone", outcome: "contact_made", customerIntent: "客户明确希望继续了解服务及所需材料", summary: "客户已详细讨论开户所需资料并确认后续安排", nextAction: "准备开户文件清单并安排下周再次电话沟通", nextFollowUpAt: new Date(Date.now() + 86400000 * 3).toISOString(), confirmDuplicateFollowUp: true };
before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getTestD1PlatformProxy<{
        DB: unknown;
    }>();
    db = drizzle(proxy.env.DB, { schema });
    dispose = proxy.dispose;
    bindTestDatabase(db);
    admin = (await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.admin)))[0];
    const now = new Date().toISOString();
    await db.insert(schema.customers).values({ id: customerId, customerName: "SYNTHETIC F1", customerType: "individual", source: "other", requestedProjectName: "Synthetic", ownerId: admin.id, status: "active", salesStage: "contacted", createdBy: admin.id, updatedBy: admin.id, createdAt: now, updatedAt: now });
});
after(async () => { bindTestDatabase(null); await dispose?.(); });
const post = (submissionId: string, body: Record<string, unknown> = {}) => createCustomerFollowUp(new Request('http://localhost/api/customers/' + customerId + '/follow-ups', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, submissionId, ...body }) }), customerId, admin);
it("same logical submission recovers one canonical follow-up after response loss", async () => {
    const submissionId = crypto.randomUUID();
    const first = await post(submissionId);
    assert.equal(first.status, 201, await first.clone().text());
    const retry = await post(submissionId);
    assert.equal(retry.status, 201, await retry.clone().text());
    assert.equal((await first.json()).id, (await retry.json()).id);
    assert.equal((await db.select().from(schema.followUps).where(eq(schema.followUps.customerId, customerId))).length, 1);
});
it("two synchronized requests commit once, including task, reclamation and created audit", async () => {
    const { mock } = await import('node:test');
    const submissionId = crypto.randomUUID();
    const customer = (await db.select().from(schema.customers).where(eq(schema.customers.id, customerId)))[0];
    const pendingId = crypto.randomUUID(), now = new Date().toISOString();
    await db.insert(schema.reclamationActionItems).values({ id: pendingId, userId: admin.id, customerId, cycleStartedAt: customer.reclamationCycleStartedAt!, riskEpisodeKey: pendingId, actionState: 'pending', riskBand: 'routine', idleDays: 0, reclaimDaysSnapshot: 30, createdAt: now, updatedAt: now });
    let arrivals = 0, release = () => { };
    const ready = new Promise<void>(r => { release = r; });
    const original = db.batch.bind(db);
    const stub = mock.method(db, 'batch', async (...args: Parameters<typeof db.batch>) => { arrivals++; if (arrivals === 2)
        release(); if (arrivals <= 2)
        await ready; return original(...args); });
    let responses: Response[];
    try {
        responses = await Promise.all([post(submissionId), post(submissionId)]);
    }
    finally {
        stub.mock.restore();
    }
    assert.equal(arrivals, 2);
    for (const response of responses) {
        assert.equal(response.status, 201);
        assert.equal((await response.json()).id, submissionId);
    }
    assert.equal((await db.select().from(schema.followUps).where(eq(schema.followUps.id, submissionId))).length, 1);
    assert.equal((await db.select().from(schema.tasks).where(eq(schema.tasks.customerId, customerId))).length, 1);
    const item = (await db.select().from(schema.reclamationActionItems).where(eq(schema.reclamationActionItems.id, pendingId)))[0];
    assert.equal(item.actionState, 'completed');
    assert.equal(item.completedFollowUpId, submissionId);
    const audits = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, submissionId));
    assert.equal(audits.filter(a => a.action === 'follow_up.created').length, 1);
    const before = await snapshot();
    await post(submissionId);
    assert.deepEqual(await snapshot(), before);
});
async function snapshot() {
    return { customer: await db.select().from(schema.customers).where(eq(schema.customers.id, customerId)), followUps: await db.select().from(schema.followUps).where(eq(schema.followUps.customerId, customerId)), tasks: await db.select().from(schema.tasks).where(eq(schema.tasks.customerId, customerId)), reclamation: await db.select().from(schema.reclamationActionItems).where(eq(schema.reclamationActionItems.customerId, customerId)), audits: (await db.select().from(schema.auditLogs)).filter(a => a.action === 'follow_up.created' || a.action === 'task.created' || a.action === 'task.updated'), notifications: await db.select().from(schema.notifications) };
}
it("committed batch response loss recovers canonical receipt without repeating effects", async () => {
    const { mock } = await import('node:test');
    const id = crypto.randomUUID();
    const original = db.batch.bind(db);
    const stub = mock.method(db, 'batch', async (...args: Parameters<typeof db.batch>) => { await original(...args); throw new Error('synthetic response loss after commit'); });
    let response: Response;
    try {
        response = await post(id);
    }
    finally {
        stub.mock.restore();
    }
    assert.equal(response.status, 201);
    const receipt = await response.json();
    assert.equal(receipt.id, id);
    const before = await snapshot();
    assert.deepEqual(await (await post(id)).json(), receipt);
    assert.deepEqual(await snapshot(), before);
});
it("late batch failure rolls back all business writes and the same identity can retry", async () => {
    const { sql } = await import('drizzle-orm');
    const id = crypto.randomUUID();
    const before = await snapshot();
    await db.run(sql.raw("CREATE TRIGGER f1_fail_audit BEFORE INSERT ON audit_logs WHEN NEW.action = 'follow_up.created' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END"));
    try {
        await assert.rejects(() => post(id));
        assert.deepEqual(await snapshot(), before);
    }
    finally {
        await db.run(sql.raw('DROP TRIGGER f1_fail_audit'));
    }
    assert.equal((await post(id)).status, 201);
});
it("new identity preserves duplicate-content confirmation; same identity never bypasses payload ownership", async () => {
    const id = crypto.randomUUID();
    const before = await snapshot();
    const blocked = await post(id, { confirmDuplicateFollowUp: false });
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).errorCode, 'FOLLOW_UP_DUPLICATE_CONTENT');
    assert.deepEqual(await snapshot(), before);
    assert.equal((await post(id)).status, 201);
    const saved = await snapshot();
    assert.equal((await post(id, { summary: input.summary + ' Different content' })).status, 409);
    assert.deepEqual(await snapshot(), saved);
    assert.equal((await post(id, { confirmDuplicateFollowUp: false })).status, 201);
});
it("invalid input/identity and denied actor produce zero follow-up business mutations", async () => {
    const before = await snapshot();
    assert.equal((await post('invalid-id')).status, 400);
    assert.equal((await post(crypto.randomUUID(), { summary: '' })).status, 400);
    const staff = (await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.staffA)))[0];
    await assert.rejects(() => createCustomerFollowUp(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ ...input, submissionId: crypto.randomUUID() }) }), customerId, staff));
    assert.deepEqual(await snapshot(), before);
});
it("timeline carries each saved nextAction, including historical null, without mixing summary", async () => {
    const { getCustomerTimeline } = await import('@/lib/customers/timeline/service');
    const rows = await db.select().from(schema.followUps).where(eq(schema.followUps.customerId, customerId));
    const oldId = crypto.randomUUID();
    await db.insert(schema.followUps).values({ ...rows[0], id: oldId, summary: 'Historical summary', nextAction: null });
    const customer = (await db.select().from(schema.customers).where(eq(schema.customers.id, customerId)))[0];
    const timeline = await getCustomerTimeline(db, admin, customer);
    const followUps = timeline.items.filter(i => i.type === 'follow_up');
    assert.equal(followUps.find(i => i.id === 'follow-up-' + oldId)?.nextAction, null);
    for (const row of rows) {
        const item = followUps.find(i => i.id === 'follow-up-' + row.id)!;
        assert.equal(item.nextAction, row.nextAction);
        assert.ok(!item.descriptionParams?.summary?.includes(input.nextAction));
    }
});
it("archived basic timeline omits saved nextAction on the server", async () => {
    const { getCustomerTimeline } = await import('@/lib/customers/timeline/service');
    const customer = (await db.select().from(schema.customers).where(eq(schema.customers.id, customerId)))[0];
    const staff = (await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.staffA)))[0];
    const timeline = await getCustomerTimeline(db, staff, { ...customer, status: 'archived', ownerId: staff.id });
    assert.equal(timeline.accessLevel, 'archived_basic');
    const rows = timeline.items.filter(i => i.type === 'follow_up');
    assert.ok(rows.length > 0);
    for (const row of rows) {
        assert.equal(row.nextAction, undefined);
        assert.equal(row.sensitive, true);
    }
});
