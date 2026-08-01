import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { markApprovalPendingNotificationsRead } from "./queries";

const APPROVAL_A = "b1-mark-read-approval-aaaa-0001";
const APPROVAL_B = "b1-mark-read-approval-bbbb-0002";
const N_PENDING_ADMIN = "b1-mark-read-pending-admin-001";
const N_PENDING_EXTRA = "b1-mark-read-pending-extra-001";
const N_PENDING_READ = "b1-mark-read-pending-read-001";
const N_PENDING_OTHER = "b1-mark-read-pending-other-001";
const N_APPROVED = "b1-mark-read-approved-001";
const N_REJECTED = "b1-mark-read-rejected-001";
const N_CUSTOMER = "b1-mark-read-customer-001";

const ALL_IDS = [
  N_PENDING_ADMIN,
  N_PENDING_EXTRA,
  N_PENDING_READ,
  N_PENDING_OTHER,
  N_APPROVED,
  N_REJECTED,
  N_CUSTOMER,
];

type Db = ReturnType<typeof drizzle<typeof schema>>;

let db: Db;
let disposeProxy: (() => Promise<void>) | undefined;

async function cleanup() {
  await db
    .delete(schema.notifications)
    .where(inArray(schema.notifications.id, ALL_IDS));
}

describe("markApprovalPendingNotificationsRead", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
    await cleanup();
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("marks only unread approval.pending for the target approval across recipients", async () => {
    await cleanup();
    const fixedCreated = "2026-07-20T10:00:00.000Z";
    await db.insert(schema.notifications).values([
      {
        id: N_PENDING_ADMIN,
        userId: SEED_IDS.admin,
        type: "approval.pending",
        title: "pending-admin",
        message: "pending-admin-msg",
        relatedEntityType: "approval",
        relatedEntityId: APPROVAL_A,
        isRead: 0,
        createdAt: fixedCreated,
      },
      {
        id: N_PENDING_EXTRA,
        userId: SEED_IDS.staffA,
        type: "approval.pending",
        title: "pending-extra",
        message: "pending-extra-msg",
        relatedEntityType: "approval",
        relatedEntityId: APPROVAL_A,
        isRead: 0,
        createdAt: fixedCreated,
      },
      {
        id: N_PENDING_READ,
        userId: SEED_IDS.staffB,
        type: "approval.pending",
        title: "pending-already-read",
        message: "pending-already-read-msg",
        relatedEntityType: "approval",
        relatedEntityId: APPROVAL_A,
        isRead: 1,
        createdAt: fixedCreated,
      },
      {
        id: N_PENDING_OTHER,
        userId: SEED_IDS.admin,
        type: "approval.pending",
        title: "pending-other-approval",
        message: "pending-other-msg",
        relatedEntityType: "approval",
        relatedEntityId: APPROVAL_B,
        isRead: 0,
        createdAt: fixedCreated,
      },
      {
        id: N_APPROVED,
        userId: SEED_IDS.staffA,
        type: "approval.approved",
        title: "approved",
        message: "approved-msg",
        relatedEntityType: "approval",
        relatedEntityId: APPROVAL_A,
        isRead: 0,
        createdAt: fixedCreated,
      },
      {
        id: N_REJECTED,
        userId: SEED_IDS.staffA,
        type: "approval.rejected",
        title: "rejected",
        message: "rejected-msg",
        relatedEntityType: "approval",
        relatedEntityId: APPROVAL_A,
        isRead: 0,
        createdAt: fixedCreated,
      },
      {
        id: N_CUSTOMER,
        userId: SEED_IDS.admin,
        type: "customer.transferred",
        title: "customer",
        message: "customer-msg",
        relatedEntityType: "customer",
        relatedEntityId: SEED_IDS.customerStaffA,
        isRead: 0,
        createdAt: fixedCreated,
      },
    ]);

    const first = await markApprovalPendingNotificationsRead(db, APPROVAL_A);
    assert.equal(first.markedReadCount, 2);

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(inArray(schema.notifications.id, ALL_IDS));

    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

    assert.equal(byId[N_PENDING_ADMIN]?.isRead, 1);
    assert.equal(byId[N_PENDING_EXTRA]?.isRead, 1);
    assert.equal(byId[N_PENDING_READ]?.isRead, 1);
    assert.equal(byId[N_PENDING_OTHER]?.isRead, 0);
    assert.equal(byId[N_APPROVED]?.isRead, 0);
    assert.equal(byId[N_REJECTED]?.isRead, 0);
    assert.equal(byId[N_CUSTOMER]?.isRead, 0);

    assert.equal(byId[N_PENDING_ADMIN]?.title, "pending-admin");
    assert.equal(byId[N_PENDING_ADMIN]?.message, "pending-admin-msg");
    assert.equal(byId[N_PENDING_ADMIN]?.createdAt, fixedCreated);
    assert.equal(byId[N_PENDING_EXTRA]?.title, "pending-extra");
    assert.equal(byId[N_PENDING_EXTRA]?.message, "pending-extra-msg");
    assert.equal(byId[N_PENDING_EXTRA]?.createdAt, fixedCreated);

    const second = await markApprovalPendingNotificationsRead(db, APPROVAL_A);
    assert.equal(second.markedReadCount, 0);

    const after = await db
      .select({ isRead: schema.notifications.isRead })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.relatedEntityType, "approval"),
          eq(schema.notifications.relatedEntityId, APPROVAL_A),
          eq(schema.notifications.type, "approval.pending"),
        ),
      );
    assert.ok(after.every((row) => row.isRead === 1));
  });
});
