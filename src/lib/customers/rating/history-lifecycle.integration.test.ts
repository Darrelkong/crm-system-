import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import { bindTestDatabase, schema } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { permanentlyDeleteCustomerFromRecycleBin, purgeExpiredRecycleBinCustomers } from "@/lib/recycle-bin/service";
let db: ReturnType<typeof drizzle<typeof schema>>;
before(async () => {
  process.env.CRM_ALLOW_TEST_DB_BIND = "1";
  const proxy = await getTestD1PlatformProxy<{ DB: unknown }>();
  db = drizzle(proxy.env.DB, { schema }); bindTestDatabase(db);
});
after(() => bindTestDatabase(null));
async function fixture() {
  const id = crypto.randomUUID(), followUpId = crypto.randomUUID(), historyId = crypto.randomUUID();
  const createdAt = "2025-01-01T00:00:00.000Z";
  await db.insert(schema.customers).values({ id, customerName: "Synthetic rating purge", source: "other", ownerId: SEED_IDS.admin,
    createdBy: SEED_IDS.admin, createdAt, updatedAt: createdAt, status: "archived", deletedAt: createdAt });
  const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.id, id));
  assert.equal(customer.customerRating, null); assert.equal(customer.customerRatingRevision, 0);
  await db.insert(schema.followUps).values({ id: followUpId, customerId: id, userId: SEED_IDS.admin, followUpTime: createdAt,
    channel: "phone", outcome: "replied", summary: "Synthetic", content: "Synthetic legacy", createdAt });
  await db.insert(schema.customerRatingHistory).values({ id: historyId, customerId: id, followUpId, actorUserId: SEED_IDS.admin,
    ratingBefore: null, ratingAfter: "A", action: "follow_up_confirmed", revisionBefore: 0, revisionAfter: 1, recordedAt: createdAt });
  return { id, followUpId, historyId };
}
it("Drizzle mapping and SET NULL retain the original human decision on follow-up deletion", async () => {
  const { id, followUpId, historyId } = await fixture();
  await db.delete(schema.followUps).where(eq(schema.followUps.id, followUpId));
  const [row] = await db.select().from(schema.customerRatingHistory).where(eq(schema.customerRatingHistory.id, historyId));
  assert.equal(row.followUpId, null); assert.equal(row.ratingAfter, "A"); assert.equal(row.revisionAfter, 1);
  await db.delete(schema.customers).where(eq(schema.customers.id, id));
});
it("existing manual recycle-bin permanent deletion clears rating history in its existing transaction", async () => {
  const { id, historyId } = await fixture();
  const [admin] = await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.admin));
  await permanentlyDeleteCustomerFromRecycleBin(admin, id);
  assert.deepEqual(await db.select().from(schema.customerRatingHistory).where(eq(schema.customerRatingHistory.id, historyId)), []);
  const audits = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, id));
  assert.equal(audits.filter((a) => a.action === "customer.deleted.permanent").length, 1);
});
it("existing expiry purge clears rating history without lifecycle code changes", async () => {
  const { id, historyId } = await fixture();
  await purgeExpiredRecycleBinCustomers(db, { now: new Date("2026-09-27T00:00:00Z") });
  assert.deepEqual(await db.select().from(schema.customers).where(eq(schema.customers.id, id)), []);
  assert.deepEqual(await db.select().from(schema.customerRatingHistory).where(eq(schema.customerRatingHistory.id, historyId)), []);
});
