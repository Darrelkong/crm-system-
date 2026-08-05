import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "./queries";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

const TEST_USER = "55555555-5555-5555-5555-555555555599";

async function cleanup() {
  await db
    .delete(schema.notifications)
    .where(eq(schema.notifications.userId, TEST_USER));
}

describe("mark-all-read server enforcement", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
    await db.insert(schema.users).values({
      id: TEST_USER,
      email: "mark-all-read-test@crm.local",
      displayName: "Mark All Read Test",
      passwordHash: "hash",
      role: "staff",
      isActive: 1,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).onConflictDoNothing();
    await cleanup();
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("marks informational unread only and retains pending items", async () => {
    const now = new Date().toISOString();
    await db.insert(schema.notifications).values([
      {
        id: crypto.randomUUID(),
        userId: TEST_USER,
        type: "customer.transferred",
        title: "info",
        message: "info",
        isRead: 0,
        actionState: "informational",
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        userId: TEST_USER,
        type: "approval.pending",
        title: "pending",
        message: "pending",
        isRead: 0,
        actionState: "pending",
        createdAt: now,
      },
    ]);

    const result = await markAllNotificationsRead(db, TEST_USER);
    assert.equal(result.markedCount, 1);
    assert.equal(result.retainedCount, 1);

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, TEST_USER));
    const pending = rows.find((row) => row.actionState === "pending");
    assert.equal(pending?.isRead, 0);
  });

  it("allows pending item to be marked read individually without completing", async () => {
    await cleanup();
    const now = new Date().toISOString();
    const pendingId = crypto.randomUUID();
    await db.insert(schema.notifications).values({
      id: pendingId,
      userId: TEST_USER,
      type: "reclamation.summary.staff",
      title: "summary",
      message: "summary",
      isRead: 0,
      actionState: "pending",
      groupingKey: `reclamation:staff:${TEST_USER}`,
      createdAt: now,
    });

    const read = await markNotificationRead(db, TEST_USER, pendingId);
    assert.equal(read.ok, true);

    const row = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, pendingId));
    assert.equal(row[0]?.isRead, 1);
    assert.equal(row[0]?.actionState, "pending");
  });
});
