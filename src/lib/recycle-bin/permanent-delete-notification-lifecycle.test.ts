import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  permanentlyDeleteCustomerFromRecycleBin,
  purgeExpiredRecycleBinCustomers,
} from "@/lib/recycle-bin/service";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const FIXED_NOW = new Date("2026-06-26T12:00:00.000Z");
const EXPIRED_DELETED_AT = "2026-03-01T12:00:00.000Z";

const CUSTOMER_ID = "pd-lifecycle-batch-cust-0001";
const APPROVAL_ID = "pd-lifecycle-batch-appr-0001";
const N_PENDING = "pd-lifecycle-batch-n-pending";
const N_APPROVED = "pd-lifecycle-batch-n-approved";
const N_CUSTOMER = "pd-lifecycle-batch-n-customer";

type Db = ReturnType<typeof drizzle<typeof schema>>;

let db: Db;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;

async function cleanup() {
  await db
    .delete(schema.auditLogs)
    .where(eq(schema.auditLogs.entityId, CUSTOMER_ID));
  await db
    .delete(schema.notifications)
    .where(inArray(schema.notifications.id, [N_PENDING, N_APPROVED, N_CUSTOMER]));
  await db
    .delete(schema.approvals)
    .where(eq(schema.approvals.id, APPROVAL_ID));
  await db
    .delete(schema.reclamationWarningLogs)
    .where(eq(schema.reclamationWarningLogs.customerId, CUSTOMER_ID));
  await db
    .delete(schema.tasks)
    .where(eq(schema.tasks.customerId, CUSTOMER_ID));
  await db
    .delete(schema.customers)
    .where(eq(schema.customers.id, CUSTOMER_ID));
}

async function seedArchivedCustomerWithApprovalNotifications() {
  const now = "2026-02-01T12:00:00.000Z";
  await db.insert(schema.customers).values({
    id: CUSTOMER_ID,
    customerName: "PD Lifecycle Batch",
    customerCode: "EF-PD-LC-01",
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
    deletedAt: EXPIRED_DELETED_AT,
    deletedBy: SEED_IDS.admin,
    deletedReason: "lifecycle batch test",
  });

  await db.insert(schema.approvals).values({
    id: APPROVAL_ID,
    requestType: "delete_customer",
    status: "approved",
    customerId: CUSTOMER_ID,
    requestedBy: SEED_IDS.staffA,
    reason: "lifecycle batch",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.notifications).values([
    {
      id: N_PENDING,
      userId: SEED_IDS.admin,
      type: "approval.pending",
      title: "pending",
      message: "pending-msg",
      relatedEntityType: "approval",
      relatedEntityId: APPROVAL_ID,
      isRead: 0,
      createdAt: now,
    },
    {
      id: N_APPROVED,
      userId: SEED_IDS.staffA,
      type: "approval.approved",
      title: "approved",
      message: "approved-msg",
      relatedEntityType: "approval",
      relatedEntityId: APPROVAL_ID,
      isRead: 0,
      createdAt: now,
    },
    {
      id: N_CUSTOMER,
      userId: SEED_IDS.staffA,
      type: "customer_auto_reclaimed",
      title: "customer",
      message: "customer-msg",
      relatedEntityType: "customer",
      relatedEntityId: CUSTOMER_ID,
      isRead: 0,
      createdAt: now,
    },
  ]);
}

describe("permanent delete approval notification lifecycle wiring", () => {
  it("executePermanentDeleteInBatch marks approval notifications before deleting approvals", () => {
    const src = read("src/lib/recycle-bin/service.ts");
    const fn = src.slice(
      src.indexOf("async function executePermanentDeleteInBatch"),
      src.indexOf("export async function permanentlyDeleteCustomerFromRecycleBin"),
    );

    assert.match(
      fn,
      /buildMarkApprovalNotificationsReadForCustomerStatement\(db,\s*customer\.id\)/,
    );
    assert.match(
      fn,
      /buildMarkApprovalNotificationsReadForCustomerStatement[\s\S]*?\.delete\(schema\.approvals\)/,
    );
    assert.match(
      fn,
      /\.delete\(schema\.approvals\)[\s\S]*?eq\(schema\.approvals\.customerId,\s*customer\.id\)/,
    );
    assert.match(fn, /delete\(schema\.reclamationWarningLogs\)/);
    assert.match(fn, /buildCancelOpenTasksForCustomerStatement/);
    assert.match(fn, /customer\.deleted\.permanent/);
    assert.match(
      fn,
      /\.delete\(schema\.customers\)[\s\S]*?status,\s*"archived"[\s\S]*?isNotNull\(schema\.customers\.deletedAt\)/,
    );

    const markIdx = fn.indexOf(
      "buildMarkApprovalNotificationsReadForCustomerStatement",
    );
    const deleteApprovalsIdx = fn.indexOf(".delete(schema.approvals)");
    const deleteCustomerIdx = fn.lastIndexOf(".delete(schema.customers)");
    assert.ok(markIdx >= 0 && deleteApprovalsIdx > markIdx);
    assert.ok(deleteCustomerIdx > deleteApprovalsIdx);

    assert.match(
      fn,
      /db\.batch\(\s*batchStatements/,
    );
    assert.doesNotMatch(fn, /markApprovalPendingNotificationsReadSafely/);
    assert.doesNotMatch(fn, /notification-safe/);
  });

  it("manual and cron permanent-delete entries share executePermanentDeleteInBatch", () => {
    const service = read("src/lib/recycle-bin/service.ts");
    const manual = service.slice(
      service.indexOf("export async function permanentlyDeleteCustomerFromRecycleBin"),
      service.indexOf("export async function previewExpiredRecycleBinCustomers"),
    );
    const cron = service.slice(
      service.indexOf("export async function purgeExpiredRecycleBinCustomers"),
    );
    assert.match(manual, /executePermanentDeleteInBatch/);
    assert.match(cron, /executePermanentDeleteInBatch/);
    assert.doesNotMatch(
      manual,
      /buildMarkApprovalNotificationsReadForCustomerStatement/,
    );
    assert.doesNotMatch(
      cron,
      /buildMarkApprovalNotificationsReadForCustomerStatement/,
    );

    const route = read(
      "src/app/api/admin/recycle-bin/[customerId]/permanent-delete/route.ts",
    );
    assert.match(route, /permanentlyDeleteCustomerFromRecycleBin/);
    assert.doesNotMatch(
      route,
      /buildMarkApprovalNotificationsReadForCustomerStatement|executePermanentDeleteInBatch/,
    );

    const cronWorker = read("workers/recycle-bin-cron.ts");
    assert.match(cronWorker, /purgeExpiredRecycleBinCustomers/);
    assert.doesNotMatch(
      cronWorker,
      /buildMarkApprovalNotificationsReadForCustomerStatement|executePermanentDeleteInBatch/,
    );

    const approvals = read("src/lib/approvals/service.ts");
    const deleteCase = approvals.slice(
      approvals.indexOf('case "delete_customer"'),
      approvals.indexOf('case "transfer_customer"'),
    );
    assert.match(deleteCase, /status:\s*"archived"/);
    assert.doesNotMatch(
      deleteCase,
      /executePermanentDeleteInBatch|buildMarkApprovalNotificationsReadForCustomerStatement/,
    );
    assert.doesNotMatch(
      approvals,
      /buildMarkApprovalNotificationsReadForCustomerStatement/,
    );
  });

  it("B1 pending mark-read helper remains unchanged and separate", () => {
    const src = read("src/lib/notifications/queries.ts");
    const b1 = src.slice(
      src.indexOf("export async function markApprovalPendingNotificationsRead"),
      src.indexOf(
        "export function buildMarkApprovalNotificationsReadForCustomerStatement",
      ),
    );
    assert.match(b1, /type,\s*"approval\.pending"/);
    assert.match(b1, /relatedEntityId,\s*approvalId/);
    assert.doesNotMatch(b1, /customerId|approvals\.customerId/);
  });
});

describe("permanent delete approval notification lifecycle DB", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;

    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SEED_IDS.admin))
      .limit(1);
    adminUser = users[0]!;
    await cleanup();
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("manual permanent delete marks approval notifications read and keeps rows as orphans", async () => {
    await cleanup();
    await seedArchivedCustomerWithApprovalNotifications();

    await permanentlyDeleteCustomerFromRecycleBin(adminUser, CUSTOMER_ID, {
      source: "manual",
    });

    const customer = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(eq(schema.customers.id, CUSTOMER_ID));
    assert.equal(customer.length, 0);

    const approvals = await db
      .select({ id: schema.approvals.id })
      .from(schema.approvals)
      .where(eq(schema.approvals.id, APPROVAL_ID));
    assert.equal(approvals.length, 0);

    const notifs = await db
      .select()
      .from(schema.notifications)
      .where(inArray(schema.notifications.id, [N_PENDING, N_APPROVED, N_CUSTOMER]));
    assert.equal(notifs.length, 3);
    const byId = Object.fromEntries(notifs.map((row) => [row.id, row]));

    assert.equal(byId[N_PENDING]?.isRead, 1);
    assert.equal(byId[N_APPROVED]?.isRead, 1);
    assert.equal(byId[N_CUSTOMER]?.isRead, 0);
    assert.equal(byId[N_PENDING]?.relatedEntityId, APPROVAL_ID);
    assert.equal(byId[N_APPROVED]?.relatedEntityId, APPROVAL_ID);
    assert.equal(byId[N_PENDING]?.title, "pending");
    assert.equal(byId[N_APPROVED]?.message, "approved-msg");
    assert.equal(byId[N_APPROVED]?.createdAt, "2026-02-01T12:00:00.000Z");

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, CUSTOMER_ID),
          eq(schema.auditLogs.action, "customer.deleted.permanent"),
        ),
      );
    assert.equal(audits.length, 1);
    const metadata = JSON.parse(audits[0]!.metadata ?? "{}") as Record<
      string,
      unknown
    >;
    assert.equal(metadata.source, "manual");
    assert.equal(metadata.customerId, CUSTOMER_ID);
    assert.equal("notificationIds" in metadata, false);
    assert.equal("notificationCount" in metadata, false);
  });

  it("cron purge marks approval notifications read when affected>0 and succeeds when none", async () => {
    await cleanup();
    await seedArchivedCustomerWithApprovalNotifications();

    const withNotifs = await purgeExpiredRecycleBinCustomers(db, {
      now: FIXED_NOW,
      batchSize: 50,
    });
    assert.equal(withNotifs.deletedCount, 1);
    assert.equal(withNotifs.errors.length, 0);

    const after = await db
      .select({
        id: schema.notifications.id,
        isRead: schema.notifications.isRead,
      })
      .from(schema.notifications)
      .where(inArray(schema.notifications.id, [N_PENDING, N_APPROVED]));
    assert.equal(after.length, 2);
    assert.ok(after.every((row) => row.isRead === 1));

    await cleanup();
    await db.insert(schema.customers).values({
      id: CUSTOMER_ID,
      customerName: "PD Lifecycle No Approvals",
      customerType: "individual",
      phoneCountryCode: "+86",
      source: "referral",
      salesStage: "new_lead",
      status: "archived",
      ownerId: SEED_IDS.staffA,
      createdBy: SEED_IDS.staffA,
      updatedBy: SEED_IDS.admin,
      createdAt: "2026-02-01T12:00:00.000Z",
      updatedAt: "2026-02-01T12:00:00.000Z",
      deletedAt: EXPIRED_DELETED_AT,
      deletedBy: SEED_IDS.admin,
    });

    const noApprovals = await purgeExpiredRecycleBinCustomers(db, {
      now: FIXED_NOW,
      batchSize: 50,
    });
    assert.equal(noApprovals.deletedCount, 1);
    assert.equal(noApprovals.errors.length, 0);
  });
});
