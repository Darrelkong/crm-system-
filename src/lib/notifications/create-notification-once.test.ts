import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  createNotification,
  createNotificationOnce,
} from "./service";

const APPROVAL_A = "n-a1-once-approval-aaaa-0001";
const APPROVAL_B = "n-a1-once-approval-bbbb-0002";
const NOTIF_IDS_PREFIX = "n-a1-once-";

type Db = ReturnType<typeof drizzle<typeof schema>>;

let db: Db;
let disposeProxy: (() => Promise<void>) | undefined;

async function deleteTestNotifications() {
  await db
    .delete(schema.notifications)
    .where(
      and(
        eq(schema.notifications.relatedEntityType, "approval"),
        inArray(schema.notifications.relatedEntityId, [APPROVAL_A, APPROVAL_B]),
      ),
    );
  await db
    .delete(schema.notifications)
    .where(
      inArray(schema.notifications.id, [
        "n-a1-once-dup-older-0001",
        "n-a1-once-dup-newer-0002",
      ]),
    );
  await db
    .delete(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, SEED_IDS.admin),
        eq(schema.notifications.type, "backup_failed"),
        eq(schema.notifications.title, "[TEST] A1 null-entity"),
      ),
    );
}

describe("createNotificationOnce natural-key dedup", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
    await deleteTestNotifications();
  });

  after(async () => {
    await deleteTestNotifications();
    await disposeProxy?.();
  });

  it("creates once for same user+type+approval; second call returns existing", async () => {
    await deleteTestNotifications();

    const first = await createNotificationOnce(db, {
      userId: SEED_IDS.admin,
      type: "approval.pending",
      title: "Title A",
      message: "Message A",
      relatedEntityType: "approval",
      relatedEntityId: APPROVAL_A,
    });
    assert.equal(first.created, true);

    const second = await createNotificationOnce(db, {
      userId: SEED_IDS.admin,
      type: "approval.pending",
      title: "Title B Different",
      message: "Message B Different",
      relatedEntityType: "approval",
      relatedEntityId: APPROVAL_A,
    });
    assert.equal(second.created, false);
    assert.equal(second.id, first.id);

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, SEED_IDS.admin),
          eq(schema.notifications.type, "approval.pending"),
          eq(schema.notifications.relatedEntityType, "approval"),
          eq(schema.notifications.relatedEntityId, APPROVAL_A),
        ),
      );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.title, "Title A");
    assert.equal(rows[0]?.message, "Message A");
    assert.equal(rows[0]?.isRead, 0);
    assert.equal(rows[0]?.createdAt, (
      await db
        .select({ createdAt: schema.notifications.createdAt })
        .from(schema.notifications)
        .where(eq(schema.notifications.id, first.id))
        .limit(1)
    )[0]?.createdAt);
  });

  it("does not mutate existing isRead or createdAt on dedup hit", async () => {
    await deleteTestNotifications();

    const created = await createNotificationOnce(db, {
      userId: SEED_IDS.admin,
      type: "approval.approved",
      title: "Keep",
      message: "Keep msg",
      relatedEntityType: "approval",
      relatedEntityId: APPROVAL_A,
    });

    const original = (
      await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.id, created.id))
        .limit(1)
    )[0];
    assert.ok(original);

    await db
      .update(schema.notifications)
      .set({ isRead: 1 })
      .where(eq(schema.notifications.id, created.id));

    const again = await createNotificationOnce(db, {
      userId: SEED_IDS.admin,
      type: "approval.approved",
      title: "Changed",
      message: "Changed msg",
      relatedEntityType: "approval",
      relatedEntityId: APPROVAL_A,
    });
    assert.equal(again.created, false);
    assert.equal(again.id, created.id);

    const after = (
      await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.id, created.id))
        .limit(1)
    )[0];
    assert.ok(after);
    assert.equal(after.isRead, 1);
    assert.equal(after.createdAt, original.createdAt);
    assert.equal(after.title, "Keep");
    assert.equal(after.message, "Keep msg");
  });

  it("creates separately for different users, types, and approvals", async () => {
    await deleteTestNotifications();

    const a = await createNotificationOnce(db, {
      userId: SEED_IDS.admin,
      type: "approval.pending",
      title: "p",
      message: "p",
      relatedEntityType: "approval",
      relatedEntityId: APPROVAL_A,
    });
    const b = await createNotificationOnce(db, {
      userId: SEED_IDS.staffA,
      type: "approval.pending",
      title: "p",
      message: "p",
      relatedEntityType: "approval",
      relatedEntityId: APPROVAL_A,
    });
    const c = await createNotificationOnce(db, {
      userId: SEED_IDS.admin,
      type: "approval.rejected",
      title: "r",
      message: "r",
      relatedEntityType: "approval",
      relatedEntityId: APPROVAL_A,
    });
    const d = await createNotificationOnce(db, {
      userId: SEED_IDS.admin,
      type: "approval.pending",
      title: "p2",
      message: "p2",
      relatedEntityType: "approval",
      relatedEntityId: APPROVAL_B,
    });

    assert.equal(a.created, true);
    assert.equal(b.created, true);
    assert.equal(c.created, true);
    assert.equal(d.created, true);
    assert.notEqual(a.id, b.id);
    assert.notEqual(a.id, c.id);
    assert.notEqual(a.id, d.id);
  });

  it("does not use createNotificationOnce for null-entity notifications", async () => {
    // Null entity remains on createNotification path; helper requires non-null.
    const id = await createNotification(db, {
      userId: SEED_IDS.admin,
      type: "backup_failed",
      title: "[TEST] A1 null-entity",
      message: "job failed",
      relatedEntityType: null,
      relatedEntityId: null,
    });
    assert.ok(id);
    assert.doesNotMatch(id, new RegExp(`^${NOTIF_IDS_PREFIX}`));

    const id2 = await createNotification(db, {
      userId: SEED_IDS.admin,
      type: "backup_failed",
      title: "[TEST] A1 null-entity",
      message: "job failed again",
      relatedEntityType: null,
      relatedEntityId: null,
    });
    assert.notEqual(id, id2);
  });

  it("when historical duplicates exist, returns oldest and does not insert", async () => {
    await deleteTestNotifications();
    const olderId = "n-a1-once-dup-older-0001";
    const newerId = "n-a1-once-dup-newer-0002";
    await db.insert(schema.notifications).values([
      {
        id: olderId,
        userId: SEED_IDS.admin,
        type: "approval.pending",
        title: "older",
        message: "older",
        relatedEntityType: "approval",
        relatedEntityId: APPROVAL_A,
        isRead: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: newerId,
        userId: SEED_IDS.admin,
        type: "approval.pending",
        title: "newer",
        message: "newer",
        relatedEntityType: "approval",
        relatedEntityId: APPROVAL_A,
        isRead: 0,
        createdAt: "2026-06-01T00:00:00.000Z",
      },
    ]);

    const result = await createNotificationOnce(db, {
      userId: SEED_IDS.admin,
      type: "approval.pending",
      title: "attempt",
      message: "attempt",
      relatedEntityType: "approval",
      relatedEntityId: APPROVAL_A,
    });
    assert.equal(result.created, false);
    assert.equal(result.id, olderId);

    const rows = await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, SEED_IDS.admin),
          eq(schema.notifications.type, "approval.pending"),
          eq(schema.notifications.relatedEntityType, "approval"),
          eq(schema.notifications.relatedEntityId, APPROVAL_A),
        ),
      );
    assert.equal(rows.length, 2);
  });
});
