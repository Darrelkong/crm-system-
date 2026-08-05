import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import {
  getPendingActionCount,
  getUnreadNotificationCount,
  getUnreadNonPendingNotificationCount,
  getWorkItemsAttentionCount,
  markNotificationRead,
} from "./queries";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

const TEST_USER = "55555555-5555-5555-5555-555555555588";

async function cleanup() {
  await db
    .delete(schema.notifications)
    .where(eq(schema.notifications.userId, TEST_USER));
}

async function insertNotification(input: {
  id: string;
  type:
    | "customer.transferred"
    | "approval.pending"
    | "reclamation.summary.staff"
    | "auto_reclaim_warning_day_6";
  actionState: "informational" | "pending" | "completed" | "expired";
  isRead?: number;
}) {
  await db.insert(schema.notifications).values({
    id: input.id,
    userId: TEST_USER,
    type: input.type,
    title: "t",
    message: "m",
    isRead: input.isRead ?? 0,
    actionState: input.actionState,
    createdAt: new Date().toISOString(),
  });
}

describe("notification count semantics", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
    await db
      .insert(schema.users)
      .values({
        id: TEST_USER,
        email: "counts-test@crm.local",
        displayName: "Counts Test",
        passwordHash: "hash",
        role: "staff",
        isActive: 1,
        failedLoginAttempts: 0,
        lockedUntil: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoNothing();
    await cleanup();
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("counts unread pending in both unread and pending but attention only once", async () => {
    await cleanup();
    await insertNotification({
      id: "11111111-1111-1111-1111-111111111101",
      type: "reclamation.summary.staff",
      actionState: "pending",
    });

    assert.equal(await getUnreadNotificationCount(db, TEST_USER), 1);
    assert.equal(await getPendingActionCount(db, TEST_USER), 1);
    assert.equal(await getWorkItemsAttentionCount(db, TEST_USER), 1);
  });

  it("read pending keeps attention at 1 but unread at 0", async () => {
    await cleanup();
    const id = "11111111-1111-1111-1111-111111111102";
    await insertNotification({
      id,
      type: "reclamation.summary.staff",
      actionState: "pending",
    });
    await markNotificationRead(db, TEST_USER, id);

    assert.equal(await getUnreadNotificationCount(db, TEST_USER), 0);
    assert.equal(await getPendingActionCount(db, TEST_USER), 1);
    assert.equal(await getWorkItemsAttentionCount(db, TEST_USER), 1);
  });

  it("unread informational only affects unread and attention", async () => {
    await cleanup();
    await insertNotification({
      id: "11111111-1111-1111-1111-111111111103",
      type: "customer.transferred",
      actionState: "informational",
    });

    assert.equal(await getUnreadNotificationCount(db, TEST_USER), 1);
    assert.equal(await getPendingActionCount(db, TEST_USER), 0);
    assert.equal(await getWorkItemsAttentionCount(db, TEST_USER), 1);
  });

  it("combines unread informational and pending without double counting", async () => {
    await cleanup();
    await insertNotification({
      id: "11111111-1111-1111-1111-111111111104",
      type: "customer.transferred",
      actionState: "informational",
    });
    await insertNotification({
      id: "11111111-1111-1111-1111-111111111105",
      type: "customer.transferred",
      actionState: "informational",
    });
    await insertNotification({
      id: "11111111-1111-1111-1111-111111111106",
      type: "approval.pending",
      actionState: "pending",
    });
    await insertNotification({
      id: "11111111-1111-1111-1111-111111111107",
      type: "reclamation.summary.staff",
      actionState: "pending",
    });
    await insertNotification({
      id: "11111111-1111-1111-1111-111111111108",
      type: "reclamation.summary.staff",
      actionState: "pending",
    });

    assert.equal(await getUnreadNotificationCount(db, TEST_USER), 5);
    assert.equal(await getPendingActionCount(db, TEST_USER), 3);
    assert.equal(await getUnreadNonPendingNotificationCount(db, TEST_USER), 2);
    assert.equal(await getWorkItemsAttentionCount(db, TEST_USER), 5);
  });

  it("excludes legacy reclaim warnings from all counts", async () => {
    await cleanup();
    await insertNotification({
      id: "11111111-1111-1111-1111-111111111109",
      type: "auto_reclaim_warning_day_6",
      actionState: "informational",
      isRead: 0,
    });

    assert.equal(await getUnreadNotificationCount(db, TEST_USER), 0);
    assert.equal(await getPendingActionCount(db, TEST_USER), 0);
    assert.equal(await getWorkItemsAttentionCount(db, TEST_USER), 0);
  });

  it("completed read items do not affect attention", async () => {
    await cleanup();
    await insertNotification({
      id: "11111111-1111-1111-1111-111111111110",
      type: "reclamation.summary.staff",
      actionState: "completed",
      isRead: 1,
    });

    assert.equal(await getUnreadNotificationCount(db, TEST_USER), 0);
    assert.equal(await getWorkItemsAttentionCount(db, TEST_USER), 0);
  });
});
