import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import {
  getNotificationBadgeCounts,
  getPendingActionCount,
  getUnreadNonPendingNotificationCount,
  getUnreadNotificationCount,
  getWorkItemsAttentionCount,
} from "./queries";
import {
  getNotificationBadgeCountsLegacy,
  getUnreadCountApiCountsLegacy,
} from "./notification-badge-counts-legacy";
import {
  getNotificationBadgeInstrumentation,
  resetNotificationBadgeInstrumentation,
} from "./notification-badge-instrumentation";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

const TEST_USER = "55555555-5555-5555-5555-555555555599";
const OTHER_USER = "55555555-5555-5555-5555-555555555598";

async function cleanup(): Promise<void> {
  await db
    .delete(schema.notifications)
    .where(eq(schema.notifications.userId, TEST_USER));
  await db
    .delete(schema.notifications)
    .where(eq(schema.notifications.userId, OTHER_USER));
}

async function insertNotification(input: {
  id: string;
  userId?: string;
  type:
    | "customer.transferred"
    | "approval.pending"
    | "reclamation.summary.staff"
    | "auto_reclaim_warning_day_6"
    | "auto_reclaim_warning_day_7";
  actionState: "informational" | "pending" | "completed" | "expired";
  isRead?: number;
}) {
  await db.insert(schema.notifications).values({
    id: input.id,
    userId: input.userId ?? TEST_USER,
    type: input.type,
    title: "t",
    message: "m",
    isRead: input.isRead ?? 0,
    actionState: input.actionState,
    createdAt: new Date().toISOString(),
  });
}

describe("notification badge aggregate DB", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;

    const nowIso = new Date().toISOString();
    for (const user of [TEST_USER, OTHER_USER]) {
      await db
        .insert(schema.users)
        .values({
          id: user,
          email: `${user}@crm.local`,
          displayName: "Badge Test",
          passwordHash: "hash",
          role: "staff",
          isActive: 1,
          failedLoginAttempts: 0,
          lockedUntil: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .onConflictDoNothing();
    }
    await cleanup();
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("matches legacy badge counts for mixed fixture", async () => {
    await cleanup();
    await insertNotification({
      id: "11111111-1111-1111-1111-111111111201",
      type: "customer.transferred",
      actionState: "informational",
    });
    await insertNotification({
      id: "11111111-1111-1111-1111-111111111202",
      type: "approval.pending",
      actionState: "pending",
    });
    await insertNotification({
      id: "11111111-1111-1111-1111-111111111203",
      type: "reclamation.summary.staff",
      actionState: "pending",
      isRead: 1,
    });
    await insertNotification({
      id: "11111111-1111-1111-1111-111111111204",
      type: "auto_reclaim_warning_day_6",
      actionState: "informational",
    });
    await insertNotification({
      id: "11111111-1111-1111-1111-111111111205",
      type: "customer.transferred",
      actionState: "informational",
      userId: OTHER_USER,
    });

    const legacy = await getNotificationBadgeCountsLegacy(db, TEST_USER);
    const consolidated = await getNotificationBadgeCounts(db, TEST_USER);

    assert.equal(
      consolidated.unreadCount,
      await getUnreadNotificationCount(db, TEST_USER),
    );
    assert.equal(
      consolidated.pendingCount,
      await getPendingActionCount(db, TEST_USER),
    );
    assert.equal(
      consolidated.unreadNonPendingCount,
      await getUnreadNonPendingNotificationCount(db, TEST_USER),
    );
    assert.equal(
      consolidated.attentionCount,
      await getWorkItemsAttentionCount(db, TEST_USER),
    );
    assert.deepEqual(consolidated, legacy);
  });

  it("matches legacy unread-count API response fields", async () => {
    await cleanup();
    await insertNotification({
      id: "11111111-1111-1111-1111-111111111211",
      type: "customer.transferred",
      actionState: "informational",
    });
    await insertNotification({
      id: "11111111-1111-1111-1111-111111111212",
      type: "approval.pending",
      actionState: "pending",
    });

    const legacyApi = await getUnreadCountApiCountsLegacy(db, TEST_USER);
    const consolidated = await getNotificationBadgeCounts(db, TEST_USER);

    assert.equal(consolidated.unreadCount, legacyApi.unreadCount);
    assert.equal(consolidated.pendingCount, legacyApi.pendingCount);
    assert.equal(consolidated.attentionCount, legacyApi.attentionCount);
  });

  it("records one physical aggregate query", async () => {
    resetNotificationBadgeInstrumentation();
    await getNotificationBadgeCounts(db, TEST_USER);
    assert.equal(
      getNotificationBadgeInstrumentation().notificationBadgeAggregatePhysicalLoads,
      1,
    );
  });
});
