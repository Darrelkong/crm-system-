import assert from "node:assert/strict";
import { before, after, it } from "node:test";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import { bindTestDatabase, schema } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { compareCustomersForList, buildCustomerListOrderBy } from "../list-sort";
import { buildCustomerListWhere, searchCustomersForUserPaginated, listCustomersForUserPaginated } from "../queries";
import { adminPoolRatingOrderBy } from "./sort";
import { formatCustomerForUser } from "@/lib/permissions/customers";
import { formatPublicPoolListForUser, listPublicPoolCustomers, listRandomClaimCandidatesForStaff } from "@/lib/public-pool/queries";
import { buildReclamationCountdownDisplay } from "@/lib/reclamation/countdown-display";
import { listCustomersMatchingScoringFilterPaginated } from "../scoring/scoring-list-sql";
import { parseEffectiveSettings } from "@/lib/settings/effective";
import { SETTING_DEFAULTS } from "@/lib/settings/keys";
let db: ReturnType<typeof drizzle<typeof schema>>;
let admin: typeof schema.users.$inferSelect, staff: typeof admin;
const now = new Date("2026-09-27T04:00:00.000Z");
const settings = { ...parseEffectiveSettings({ ...SETTING_DEFAULTS }), automaticReclaimDays: 45, reclaimWarningDaysBefore: 3 };
const options = { now, automaticReclaimDays: 45, reclaimWarningDaysBefore: 3 };
const ago = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();
before(async () => {
  process.env.CRM_ALLOW_TEST_DB_BIND = "1";
  const proxy = await getTestD1PlatformProxy<{ DB: unknown }>(); db = drizzle(proxy.env.DB, { schema }); bindTestDatabase(db);
  admin = (await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.admin)))[0];
  staff = (await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.staffA)))[0];
});
after(() => bindTestDatabase(null));
async function seed(id: string, extra: Partial<typeof schema.customers.$inferInsert> = {}) {
  await db.insert(schema.customers).values({ id, customerName: "F4D " + id, source: "other", status: "active", salesStage: "contacted",
    ownerId: staff.id, createdBy: admin.id, createdAt: ago(10), updatedAt: ago(1), reclamationCycleStartedAt: ago(10), ...extra });
}
it("SQL and memory order match all rating, urgency, pin, follow-up and stable-ID combinations globally before pagination", async () => {
  const rows: Array<[string, Partial<typeof schema.customers.$inferInsert>]> = [
    ["due-null", { reclamationCycleStartedAt: ago(50) }],
    ["grace-early", { reclamationCycleStartedAt: ago(50), reclaimRuleGraceUntil: "2026-09-27T06:00:00.000Z" }],
    ["grace-late", { reclamationCycleStartedAt: ago(50), reclaimRuleGraceUntil: "2026-09-28T06:00:00.000Z", customerRating: "S" }],
    ["one-D", { reclamationCycleStartedAt: ago(44), customerRating: "D" }],
    ["two-S", { reclamationCycleStartedAt: ago(43), customerRating: "S" }],
    ["two-A", { reclamationCycleStartedAt: ago(43), customerRating: "A" }],
    ["normal-S", { customerRating: "S" }], ["normal-A", { customerRating: "A" }],
    ["pin-B", { customerRating: "B", isPinned: 1, pinnedAt: ago(1) }],
    ["normal-B", { customerRating: "B" }], ["normal-D", { customerRating: "D" }],
    ["visible-4d-D", { customerRating: "D", reclamationCycleStartedAt: ago(41) }],
    ["collab-D", { customerRating: "D", reclamationCycleStartedAt: ago(50) }],
  ];
  for (const [id, extra] of rows) await seed(id, extra);
  await db.insert(schema.customerAssignees).values({ id: crypto.randomUUID(), customerId: "collab-D", userId: admin.id,
    role: "collaborator", assignedAt: ago(1), createdAt: ago(1), updatedAt: ago(1) });
  for (let i = 0; i < 90; i++) await seed(`matrix-${i}`, {
    customerRating: (["S", "A", "B", "D", null] as const)[i % 5], isPinned: i % 7 === 0 ? 1 : 0,
    pinnedAt: i % 7 === 0 ? ago(i % 4) : null, reclamationCycleStartedAt: ago(i % 55),
    nextFollowUpAt: i % 3 === 0 ? ago(i % 5) : null, lastValidFollowUpAt: i % 4 === 0 ? ago(i % 6) : null,
    createdAt: ago(i % 10), salesStage: i % 19 === 0 ? "paid" : "contacted",
  });
  const all = await db.select().from(schema.customers).where(buildCustomerListWhere(staff));
  const expected = [...all].sort((a, b) => compareCustomersForList(a, b, now, { ...options, collaborativeCustomerIds: new Set(["collab-D"]) })).map(c => c.id);
  const actual: string[] = [];
  for (let page = 1; page <= 3; page++) actual.push(...(await listCustomersForUserPaginated(staff, {}, page, options)).items.map(c => c.id));
  assert.deepEqual(actual, expected); assert.equal(new Set(actual).size, all.length);
  const named = actual.filter(id => !id.startsWith("matrix-"));
  const before = (a: string, b: string) => assert.ok(named.indexOf(a) < named.indexOf(b), `${a} before ${b}`);
  before("due-null", "grace-early"); before("grace-early", "grace-late"); before("grace-late", "one-D");
  before("one-D", "two-S"); before("two-S", "two-A"); before("two-A", "normal-S");
  before("normal-A", "pin-B"); before("pin-B", "normal-B"); before("normal-B", "normal-D");
  before("normal-S", "visible-4d-D"); before("normal-S", "collab-D");
  const search = await searchCustomersForUserPaginated(staff, "F4D", {}, 1, options);
  assert.deepEqual(search.items.map(c => c.id), expected.slice(0, 40));
  const visible = all.find(c => c.id === "visible-4d-D")!;
  assert.equal(buildReclamationCountdownDisplay(visible, settings, now)?.daysRemaining, 4);
  const scored = await listCustomersMatchingScoringFilterPaginated(db, staff, {}, { completenessBelow: 101 }, 1, { settings, now });
  assert.deepEqual(scored.items.map(c => c.id), expected.slice(0, 40));
});
it("HK midnight cycle boundary and grace expiry agree in D1 and JS; S remains eligible", async () => {
  for (const [id, anchor] of [["hk-before", "2026-09-24T15:59:59.000Z"], ["hk-after", "2026-09-24T16:00:00.000Z"]])
    await seed(id, { customerRating: "S", reclamationCycleStartedAt: anchor });
  const all = await db.select().from(schema.customers).where(like(schema.customers.id, "hk-%"));
  const opts = { automaticReclaimDays: 3, reclaimWarningDaysBefore: 1 };
  const ordered = await db.select().from(schema.customers).where(like(schema.customers.id, "hk-%"))
    .orderBy(...buildCustomerListOrderBy(now, 3, 1));
  assert.deepEqual(ordered.map(c => c.id), [...all].sort((a, b) => compareCustomersForList(a, b, now, opts)).map(c => c.id));
  assert.equal(ordered[0].id, "hk-before");
});
it("Admin Pool rank is SQL-side; staff projection/order and random candidates are invariant when ratings change", async () => {
  const ids: string[] = [];
  for (const [i, rating] of ([null, "D", "B", "A", "S"] as const).entries()) {
    const id = `pool-rating-${i}`; ids.push(id); await seed(id, { status: "public_pool", ownerId: null, customerRating: rating, poolEnteredAt: ago(10 - i) });
  }
  const adminBefore = await formatPublicPoolListForUser(admin);
  assert.deepEqual(adminBefore.map(c => c.id), [...ids].reverse());
  assert.ok(adminBefore.every(c => !c.isMasked && "customerRating" in c));
  const staffBefore = await formatPublicPoolListForUser(staff);
  assert.deepEqual(staffBefore.map(c => c.id), ids);
  for (const c of staffBefore) for (const key of ["customerRating", "customerRatingRevision", "ratingHistory"]) assert.equal(key in c, false);
  const raw = await listPublicPoolCustomers();
  for (const c of raw) assert.equal("customerRating" in formatCustomerForUser(staff, c), false);
  const candidatesBefore = await listRandomClaimCandidatesForStaff({ userId: staff.id, now });
  await db.update(schema.customers).set({ customerRating: "S", customerRatingRevision: 9 }).where(inArray(schema.customers.id, ids));
  assert.deepEqual(await formatPublicPoolListForUser(staff), staffBefore);
  assert.deepEqual(await listRandomClaimCandidatesForStaff({ userId: staff.id, now }), candidatesBefore);
});
it("masked unowned assignee in normal list has rating-independent ordering and projection", async () => {
  await seed("masked-unowned", { ownerId: null, customerRating: "S" });
  await db.insert(schema.customerAssignees).values({ id: crypto.randomUUID(), customerId: "masked-unowned", userId: staff.id,
    role: "collaborator", assignedAt: ago(1), createdAt: ago(1), updatedAt: ago(1) });
  const before = await searchCustomersForUserPaginated(staff, "masked-unowned", {}, 1, options);
  assert.equal("customerRating" in formatCustomerForUser(staff, before.items[0], { isAssignee: true }), false);
  const pageBefore = await listCustomersForUserPaginated(staff, {}, 3, options);
  await db.update(schema.customers).set({ customerRating: "D" }).where(eq(schema.customers.id, "masked-unowned"));
  const pageAfter = await listCustomersForUserPaginated(staff, {}, 3, options);
  assert.deepEqual(pageAfter.items.map(c => c.id), pageBefore.items.map(c => c.id));
});
for (const size of [1000, 10000]) it(`${size} synthetic customers: real query timings and EXPLAIN plans`, async () => {
  await db.run(sql`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < ${size})
    INSERT INTO customers (id,customer_name,source,status,sales_stage,owner_id,created_by,created_at,updated_at,
      customer_rating,reclamation_cycle_started_at,pool_entered_at,is_pinned)
    SELECT 'perf-' || CAST(${size} AS INTEGER) || '-' || n,'SYNTHETIC PERF','other', CASE WHEN n%5=0 THEN 'public_pool' ELSE 'active' END,
      'contacted',CASE WHEN n%5=0 THEN NULL ELSE ${staff.id} END,${admin.id},'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',
      CASE n%7 WHEN 0 THEN 'S' WHEN 1 THEN 'A' WHEN 2 THEN 'B' WHEN 3 THEN 'D' ELSE NULL END,
      strftime('%Y-%m-%dT00:00:00.000Z', '2026-09-27', '-' || (n%55) || ' days'),'2026-01-01T00:00:00.000Z',CASE WHEN n%13=0 THEN 1 ELSE 0 END FROM seq`);
  const prefix = `perf-${size}-%`;
  for (const [name, where, order] of [
    ["normal", and(like(schema.customers.id, prefix), buildCustomerListWhere(staff)), buildCustomerListOrderBy(now)],
    ["warning", and(like(schema.customers.id, prefix), buildCustomerListWhere(staff)), buildCustomerListOrderBy(now, 45, 3)],
    ["admin-pool", and(like(schema.customers.id, prefix), eq(schema.customers.status, "public_pool")), adminPoolRatingOrderBy()],
  ] as const) {
    const ordered = db.select().from(schema.customers).where(where).orderBy(...order);
    // Match runtime: normal lists paginate; Admin Pool currently loads all Pool rows.
    const query = name === "admin-pool" ? ordered : ordered.limit(40).offset(0);
    const start = performance.now(); const result = await query; const ms = performance.now() - start;
    const plan = await db.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${query.getSQL()}`);
    console.log(JSON.stringify({ dataset: size, query: name, ms: Math.round(ms * 100) / 100, rows: result.length, plan: plan.map(p => p.detail) }));
    assert.equal(result.length, name === "admin-pool" ? size / 5 : 40); assert.ok(ms < 3000, "Local query exceeds review threshold: investigate index need");
    assert.ok(plan.length > 0);
  }
  await db.delete(schema.customers).where(like(schema.customers.id, prefix));
});
