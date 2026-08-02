import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { buildMarkApprovalNotificationsReadForCustomerStatement } from "./queries";

const CUSTOMER_A = "pd-notif-lifecycle-cust-aaaa-0001";
const CUSTOMER_B = "pd-notif-lifecycle-cust-bbbb-0002";
const APPROVAL_A1 = "pd-notif-lifecycle-appr-a1-0001";
const APPROVAL_A2 = "pd-notif-lifecycle-appr-a2-0002";
const APPROVAL_B1 = "pd-notif-lifecycle-appr-b1-0001";

const N_PENDING_ADMIN = "pd-notif-lifecycle-n-pending-admin";
const N_PENDING_STAFF = "pd-notif-lifecycle-n-pending-staff";
const N_APPROVED = "pd-notif-lifecycle-n-approved";
const N_REJECTED = "pd-notif-lifecycle-n-rejected";
const N_PENDING_READ = "pd-notif-lifecycle-n-pending-read";
const N_OTHER_CUSTOMER = "pd-notif-lifecycle-n-other-cust";
const N_CUSTOMER_TYPE = "pd-notif-lifecycle-n-customer-type";
const N_BACKUP = "pd-notif-lifecycle-n-backup";
const N_NULL_RELATED = "pd-notif-lifecycle-n-null-related";
const N_SECOND_APPROVAL = "pd-notif-lifecycle-n-second-appr";

const ALL_NOTIFICATION_IDS = [
  N_PENDING_ADMIN,
  N_PENDING_STAFF,
  N_APPROVED,
  N_REJECTED,
  N_PENDING_READ,
  N_OTHER_CUSTOMER,
  N_CUSTOMER_TYPE,
  N_BACKUP,
  N_NULL_RELATED,
  N_SECOND_APPROVAL,
];

const ALL_APPROVAL_IDS = [APPROVAL_A1, APPROVAL_A2, APPROVAL_B1];
const ALL_CUSTOMER_IDS = [CUSTOMER_A, CUSTOMER_B];

type Db = ReturnType<typeof drizzle<typeof schema>>;

let db: Db;
let disposeProxy: (() => Promise<void>) | undefined;

function extractChanges(result: unknown): number {
  if (
    result &&
    typeof result === "object" &&
    "meta" in result &&
    result.meta &&
    typeof result.meta === "object" &&
    "changes" in result.meta &&
    typeof (result.meta as { changes: unknown }).changes === "number"
  ) {
    return (result.meta as { changes: number }).changes;
  }
  return 0;
}

async function cleanup() {
  await db
    .delete(schema.notifications)
    .where(inArray(schema.notifications.id, ALL_NOTIFICATION_IDS));
  await db
    .delete(schema.approvals)
    .where(inArray(schema.approvals.id, ALL_APPROVAL_IDS));
  await db
    .delete(schema.customers)
    .where(inArray(schema.customers.id, ALL_CUSTOMER_IDS));
}

async function seedCustomersAndApprovals() {
  const now = "2026-07-01T12:00:00.000Z";
  await db.insert(schema.customers).values([
    {
      id: CUSTOMER_A,
      customerName: "PD Notif Lifecycle A",
      customerType: "individual",
      phoneCountryCode: "+86",
      source: "referral",
      salesStage: "new_lead",
      status: "archived",
      ownerId: SEED_IDS.staffA,
      createdBy: SEED_IDS.staffA,
      updatedBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
      deletedAt: "2026-03-01T12:00:00.000Z",
      deletedBy: SEED_IDS.admin,
      deletedReason: "lifecycle test",
    },
    {
      id: CUSTOMER_B,
      customerName: "PD Notif Lifecycle B",
      customerType: "individual",
      phoneCountryCode: "+86",
      source: "referral",
      salesStage: "new_lead",
      status: "active",
      ownerId: SEED_IDS.staffB,
      createdBy: SEED_IDS.staffB,
      updatedBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await db.insert(schema.approvals).values([
    {
      id: APPROVAL_A1,
      requestType: "delete_customer",
      status: "approved",
      customerId: CUSTOMER_A,
      requestedBy: SEED_IDS.staffA,
      reason: "lifecycle a1",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: APPROVAL_A2,
      requestType: "closed_won",
      status: "pending",
      customerId: CUSTOMER_A,
      requestedBy: SEED_IDS.staffA,
      reason: "lifecycle a2",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: APPROVAL_B1,
      requestType: "transfer_customer",
      status: "pending",
      customerId: CUSTOMER_B,
      requestedBy: SEED_IDS.staffB,
      reason: "lifecycle b1",
      createdAt: now,
      updatedAt: now,
    },
  ]);
}

describe("buildMarkApprovalNotificationsReadForCustomerStatement", () => {
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

  it("marks unread approval.* for the customer across types and recipients; leaves others", async () => {
    await cleanup();
    await seedCustomersAndApprovals();
    const fixedCreated = "2026-07-20T10:00:00.000Z";

    await db.insert(schema.notifications).values([
      {
        id: N_PENDING_ADMIN,
        userId: SEED_IDS.admin,
        type: "approval.pending",
        title: "pending-admin",
        message: "pending-admin-msg",
        relatedEntityType: "approval",
        relatedEntityId: APPROVAL_A1,
        isRead: 0,
        createdAt: fixedCreated,
      },
      {
        id: N_PENDING_STAFF,
        userId: SEED_IDS.staffA,
        type: "approval.pending",
        title: "pending-staff",
        message: "pending-staff-msg",
        relatedEntityType: "approval",
        relatedEntityId: APPROVAL_A1,
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
        relatedEntityId: APPROVAL_A1,
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
        relatedEntityId: APPROVAL_A1,
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
        relatedEntityId: APPROVAL_A1,
        isRead: 1,
        createdAt: fixedCreated,
      },
      {
        id: N_SECOND_APPROVAL,
        userId: SEED_IDS.admin,
        type: "approval.pending",
        title: "pending-second-approval",
        message: "pending-second-msg",
        relatedEntityType: "approval",
        relatedEntityId: APPROVAL_A2,
        isRead: 0,
        createdAt: fixedCreated,
      },
      {
        id: N_OTHER_CUSTOMER,
        userId: SEED_IDS.admin,
        type: "approval.pending",
        title: "other-customer",
        message: "other-customer-msg",
        relatedEntityType: "approval",
        relatedEntityId: APPROVAL_B1,
        isRead: 0,
        createdAt: fixedCreated,
      },
      {
        id: N_CUSTOMER_TYPE,
        userId: SEED_IDS.admin,
        type: "customer.transferred",
        title: "customer-type",
        message: "customer-type-msg",
        relatedEntityType: "customer",
        relatedEntityId: CUSTOMER_A,
        isRead: 0,
        createdAt: fixedCreated,
      },
      {
        id: N_BACKUP,
        userId: SEED_IDS.admin,
        type: "backup_failed",
        title: "backup",
        message: "backup-msg",
        relatedEntityType: "backup_job",
        relatedEntityId: "backup-job-x",
        isRead: 0,
        createdAt: fixedCreated,
      },
      {
        id: N_NULL_RELATED,
        userId: SEED_IDS.admin,
        type: "approval.pending",
        title: "null-related",
        message: "null-related-msg",
        relatedEntityType: "approval",
        relatedEntityId: null,
        isRead: 0,
        createdAt: fixedCreated,
      },
    ]);

    const first = await buildMarkApprovalNotificationsReadForCustomerStatement(
      db,
      CUSTOMER_A,
    );
    assert.equal(extractChanges(first), 5);

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(inArray(schema.notifications.id, ALL_NOTIFICATION_IDS));
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

    assert.equal(byId[N_PENDING_ADMIN]?.isRead, 1);
    assert.equal(byId[N_PENDING_STAFF]?.isRead, 1);
    assert.equal(byId[N_APPROVED]?.isRead, 1);
    assert.equal(byId[N_REJECTED]?.isRead, 1);
    assert.equal(byId[N_SECOND_APPROVAL]?.isRead, 1);
    assert.equal(byId[N_PENDING_READ]?.isRead, 1);
    assert.equal(byId[N_OTHER_CUSTOMER]?.isRead, 0);
    assert.equal(byId[N_CUSTOMER_TYPE]?.isRead, 0);
    assert.equal(byId[N_BACKUP]?.isRead, 0);
    assert.equal(byId[N_NULL_RELATED]?.isRead, 0);

    assert.equal(byId[N_PENDING_ADMIN]?.title, "pending-admin");
    assert.equal(byId[N_PENDING_ADMIN]?.message, "pending-admin-msg");
    assert.equal(byId[N_PENDING_ADMIN]?.createdAt, fixedCreated);
    assert.equal(byId[N_APPROVED]?.title, "approved");
    assert.equal(byId[N_APPROVED]?.message, "approved-msg");
    assert.equal(byId[N_APPROVED]?.createdAt, fixedCreated);
    assert.equal(byId[N_APPROVED]?.relatedEntityId, APPROVAL_A1);
    assert.equal(byId[N_APPROVED]?.userId, SEED_IDS.staffA);
    assert.equal(byId[N_APPROVED]?.type, "approval.approved");

    assert.equal(rows.length, ALL_NOTIFICATION_IDS.length);

    const second = await buildMarkApprovalNotificationsReadForCustomerStatement(
      db,
      CUSTOMER_A,
    );
    assert.equal(extractChanges(second), 0);
  });

  it("returns affected=0 without error when customer has no approvals", async () => {
    await cleanup();
    const now = "2026-07-01T12:00:00.000Z";
    await db.insert(schema.customers).values({
      id: CUSTOMER_A,
      customerName: "PD Notif Lifecycle Empty",
      customerType: "individual",
      phoneCountryCode: "+86",
      source: "referral",
      salesStage: "new_lead",
      status: "archived",
      ownerId: SEED_IDS.staffA,
      createdBy: SEED_IDS.staffA,
      updatedBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
      deletedAt: "2026-03-01T12:00:00.000Z",
      deletedBy: SEED_IDS.admin,
    });

    await db.insert(schema.notifications).values({
      id: N_OTHER_CUSTOMER,
      userId: SEED_IDS.admin,
      type: "approval.pending",
      title: "orphan-unrelated",
      message: "orphan-unrelated-msg",
      relatedEntityType: "approval",
      relatedEntityId: "nonexistent-approval-id",
      isRead: 0,
      createdAt: now,
    });

    const result = await buildMarkApprovalNotificationsReadForCustomerStatement(
      db,
      CUSTOMER_A,
    );
    assert.equal(extractChanges(result), 0);

    const [row] = await db
      .select({ isRead: schema.notifications.isRead })
      .from(schema.notifications)
      .where(eq(schema.notifications.id, N_OTHER_CUSTOMER));
    assert.equal(row?.isRead, 0);
  });

  it("statement source has no recipient filter and uses approval subquery", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/notifications/queries.ts"),
      "utf8",
    );
    const fn = src.slice(
      src.indexOf(
        "export function buildMarkApprovalNotificationsReadForCustomerStatement",
      ),
      src.indexOf("export function isRelatedCustomerMissing"),
    );
    assert.match(fn, /eq\(schema\.notifications\.isRead,\s*0\)/);
    assert.match(
      fn,
      /eq\(schema\.notifications\.relatedEntityType,\s*"approval"\)/,
    );
    assert.match(fn, /inArray\(/);
    assert.match(fn, /schema\.approvals\.customerId/);
    assert.match(fn, /isRead:\s*1/);
    assert.doesNotMatch(fn, /notifications\.userId/);
    assert.doesNotMatch(
      fn,
      /type,\s*"approval\.(pending|approved|rejected)"/,
    );
    assert.doesNotMatch(fn, /for\s*\(|while\s*\(/);
    assert.doesNotMatch(fn, /db\.batch/);
  });
});
