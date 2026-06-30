import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { purgeExpiredRecycleBinCustomers } from "@/lib/recycle-bin/service";

const FIXED_NOW = new Date("2026-06-26T12:00:00.000Z");
const EXPIRED_DELETED_AT = "2026-03-01T12:00:00.000Z";
const WITHIN_90_DELETED_AT = "2026-06-01T12:00:00.000Z";

const EXPIRED_MAIN = "d8888888-8888-8888-8888-888888888801";
const WITHIN_90 = "d8888888-8888-8888-8888-888888888802";
const ACTIVE_NOT_ARCHIVED = "d8888888-8888-8888-8888-888888888803";
const ARCHIVED_NO_DELETED = "d8888888-8888-8888-8888-888888888804";
const BATCH_EXPIRED_1 = "d8888888-8888-8888-8888-888888888811";
const BATCH_EXPIRED_2 = "d8888888-8888-8888-8888-888888888812";
const BATCH_EXPIRED_3 = "d8888888-8888-8888-8888-888888888813";

const ALL_CUSTOMER_IDS = [
  EXPIRED_MAIN,
  WITHIN_90,
  ACTIVE_NOT_ARCHIVED,
  ARCHIVED_NO_DELETED,
  BATCH_EXPIRED_1,
  BATCH_EXPIRED_2,
  BATCH_EXPIRED_3,
];

const REL_FOLLOW_UP = "f8888888-8888-8888-8888-888888888801";
const REL_FIELD_LOG = "fc888888-8888-8888-8888-888888888801";
const REL_ASSIGNEE_PRIMARY = "ca888888888888888888888888888888801";
const REL_ASSIGNEE_COLLAB = "ca888888888888888888888888888888802";
const REL_CONTACT = "cc888888-8888-8888-8888-888888888801";
const REL_AI_INSIGHT = "ai888888-8888-8888-8888-888888888801";
const REL_TASK = "t8888888-8888-8888-8888-888888888801";
const REL_TASK_COMPLETED = "t8888888-8888-8888-8888-888888888802";
const REL_TASK_CANCELLED = "t8888888-8888-8888-8888-888888888803";
const REL_NOTIFICATION = "n8888888-8888-8888-8888-888888888801";
const REL_APPROVAL = "ap888888-8888-8888-8888-888888888801";
const REL_WARNING_LOG = "rw888888-8888-8888-8888-888888888801";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

function makeCustomer(
  overrides: Partial<Customer> & Pick<Customer, "id" | "customerName">,
): Customer {
  const now = "2026-06-28T12:00:00.000Z";
  return {
    customerCode: null,
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000001",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    notes: null,
    salesStage: "new_lead",
    status: "archived",
    ownerId: SEED_IDS.staffA,
    releaserUserId: null,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    isPinned: 0,
    pinnedAt: null,
    lastFollowUpAt: null,
    lastValidFollowUpAt: null,
    nextFollowUpAt: null,
    createdBy: SEED_IDS.staffA,
    updatedBy: SEED_IDS.admin,
    createdAt: now,
    updatedAt: now,
    deletedAt: EXPIRED_DELETED_AT,
    deletedBy: SEED_IDS.admin,
    deletedReason: "purge relations test",
    ...overrides,
  } as Customer;
}

async function upsertCustomer(customer: Customer) {
  const existing = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(eq(schema.customers.id, customer.id))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(schema.customers)
      .set(customer)
      .where(eq(schema.customers.id, customer.id));
  } else {
    await db.insert(schema.customers).values(customer);
  }
}

async function seedExpiredCustomerRelations(customerId: string) {
  const ts = "2026-02-01T12:00:00.000Z";

  await db.insert(schema.followUps).values({
    id: REL_FOLLOW_UP,
    customerId,
    userId: SEED_IDS.staffA,
    followUpTime: ts,
    channel: "phone",
    outcome: "connected",
    summary: "Purge relation follow-up",
    content: "Purge relation follow-up",
    isValidFollowUp: 1,
    createdAt: ts,
  });

  await db.insert(schema.fieldChangeLogs).values({
    id: REL_FIELD_LOG,
    customerId,
    fieldName: "status",
    oldValue: "active",
    newValue: "archived",
    changedBy: SEED_IDS.admin,
    changedAt: ts,
  });

  await db.insert(schema.customerAssignees).values([
    {
      id: REL_ASSIGNEE_PRIMARY,
      customerId,
      userId: SEED_IDS.staffA,
      role: "primary",
      assignedBy: SEED_IDS.admin,
      assignedAt: ts,
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: REL_ASSIGNEE_COLLAB,
      customerId,
      userId: SEED_IDS.staffB,
      role: "collaborator",
      assignedBy: SEED_IDS.admin,
      assignedAt: ts,
      createdAt: ts,
      updatedAt: ts,
    },
  ]);

  await db.insert(schema.customerContacts).values({
    id: REL_CONTACT,
    customerId,
    name: "Purge Contact",
    phone: "13800009999",
    isPrimary: 1,
    createdAt: ts,
    updatedAt: ts,
  });

  await db.insert(schema.customerAiInsights).values({
    id: REL_AI_INSIGHT,
    customerId,
    intentLevel: "medium",
    intentScore: 50,
    customerSummary: "Purge test summary",
    currentSituation: "Purge test situation",
    keySignalsJson: "[]",
    riskFlagsJson: "[]",
    missingInformationJson: "[]",
    nextBestAction: "Follow up",
    suggestedEmployeeMessage: "Hello",
    confidence: 0.8,
    reasoning: "Test",
    model: "mock",
    promptVersion: "v1",
    sourceHash: `purge-test-${customerId}`,
    status: "ready",
    generatedAt: ts,
    createdAt: ts,
    updatedAt: ts,
  });

  await db.insert(schema.tasks).values({
    id: REL_TASK,
    customerId,
    assignedTo: SEED_IDS.staffA,
    createdBy: SEED_IDS.staffA,
    title: "跟进客户：Purge Relations Test",
    type: "follow_up",
    status: "open",
    dueAt: "2026-07-01T12:00:00.000Z",
    createdAt: ts,
    updatedAt: ts,
  });

  await db.insert(schema.tasks).values({
    id: REL_TASK_COMPLETED,
    customerId,
    assignedTo: SEED_IDS.staffA,
    createdBy: SEED_IDS.staffA,
    title: "跟进客户：Purge Completed Task",
    type: "follow_up",
    status: "completed",
    dueAt: "2026-01-01T12:00:00.000Z",
    completedAt: ts,
    createdAt: ts,
    updatedAt: ts,
  });

  await db.insert(schema.tasks).values({
    id: REL_TASK_CANCELLED,
    customerId,
    assignedTo: SEED_IDS.staffA,
    createdBy: SEED_IDS.staffA,
    title: "跟进客户：Purge Cancelled Task",
    type: "follow_up",
    status: "cancelled",
    dueAt: "2026-01-01T12:00:00.000Z",
    createdAt: ts,
    updatedAt: ts,
  });

  await db.insert(schema.notifications).values({
    id: REL_NOTIFICATION,
    userId: SEED_IDS.staffA,
    type: "customer_auto_reclaimed",
    title: "客户已回收",
    message: "Purge relation notification",
    relatedEntityType: "customer",
    relatedEntityId: customerId,
    isRead: 0,
    createdAt: ts,
  });

  await db.insert(schema.approvals).values({
    id: REL_APPROVAL,
    requestType: "delete_customer",
    status: "pending",
    customerId,
    requestedBy: SEED_IDS.staffA,
    reason: "Purge relation approval",
    createdAt: ts,
    updatedAt: ts,
  });

  await db.insert(schema.reclamationWarningLogs).values({
    id: REL_WARNING_LOG,
    customerId,
    warningType: "day_6",
    warningDate: "2026-02-01",
    ownerId: SEED_IDS.staffA,
    createdAt: ts,
  });
}

async function deleteTestData() {
  const relationIds = {
    followUps: [REL_FOLLOW_UP],
    fieldChangeLogs: [REL_FIELD_LOG],
    customerAssignees: [REL_ASSIGNEE_PRIMARY, REL_ASSIGNEE_COLLAB],
    customerContacts: [REL_CONTACT],
    customerAiInsights: [REL_AI_INSIGHT],
    tasks: [REL_TASK, REL_TASK_COMPLETED, REL_TASK_CANCELLED],
    notifications: [REL_NOTIFICATION],
    approvals: [REL_APPROVAL],
    reclamationWarningLogs: [REL_WARNING_LOG],
  };

  for (const customerId of ALL_CUSTOMER_IDS) {
    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, customerId));
  }

  await db
    .delete(schema.notifications)
    .where(inArray(schema.notifications.id, relationIds.notifications));
  await db
    .delete(schema.tasks)
    .where(inArray(schema.tasks.id, relationIds.tasks));
  await db
    .delete(schema.approvals)
    .where(inArray(schema.approvals.id, relationIds.approvals));
  await db
    .delete(schema.reclamationWarningLogs)
    .where(inArray(schema.reclamationWarningLogs.id, relationIds.reclamationWarningLogs));
  await db
    .delete(schema.customerAiInsights)
    .where(inArray(schema.customerAiInsights.id, relationIds.customerAiInsights));
  await db
    .delete(schema.customerContacts)
    .where(inArray(schema.customerContacts.id, relationIds.customerContacts));
  await db
    .delete(schema.customerAssignees)
    .where(inArray(schema.customerAssignees.id, relationIds.customerAssignees));
  await db
    .delete(schema.fieldChangeLogs)
    .where(inArray(schema.fieldChangeLogs.id, relationIds.fieldChangeLogs));
  await db
    .delete(schema.followUps)
    .where(inArray(schema.followUps.id, relationIds.followUps));

  for (const customerId of ALL_CUSTOMER_IDS) {
    await db
      .delete(schema.followUps)
      .where(eq(schema.followUps.customerId, customerId));
    await db
      .delete(schema.fieldChangeLogs)
      .where(eq(schema.fieldChangeLogs.customerId, customerId));
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, customerId));
    await db
      .delete(schema.customerContacts)
      .where(eq(schema.customerContacts.customerId, customerId));
    await db
      .delete(schema.customerAiInsights)
      .where(eq(schema.customerAiInsights.customerId, customerId));
    await db
      .delete(schema.tasks)
      .where(eq(schema.tasks.customerId, customerId));
    await db
      .delete(schema.approvals)
      .where(eq(schema.approvals.customerId, customerId));
    await db
      .delete(schema.reclamationWarningLogs)
      .where(eq(schema.reclamationWarningLogs.customerId, customerId));
    await db
      .delete(schema.notifications)
      .where(eq(schema.notifications.relatedEntityId, customerId));
    await db
      .delete(schema.customers)
      .where(eq(schema.customers.id, customerId));
  }
}

async function customerExists(customerId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1);
  return rows.length > 0;
}

describe("purgeExpiredRecycleBinCustomers relation cleanup", () => {
  before(async () => {
    const proxy = await getPlatformProxy({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
  });

  after(async () => {
    await deleteTestData();
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  it("A-G: purges eligible customer and documents relation behavior", async () => {
    await deleteTestData();

    await upsertCustomer(
      makeCustomer({
        id: EXPIRED_MAIN,
        customerName: "Purge Relations Main",
        customerCode: "EF-PURGE-01",
        deletedAt: EXPIRED_DELETED_AT,
        deletedReason: "超期回收站清理",
      }),
    );
    await seedExpiredCustomerRelations(EXPIRED_MAIN);

    const result = await purgeExpiredRecycleBinCustomers(db, {
      now: FIXED_NOW,
      batchSize: 50,
    });

    assert.equal(result.deletedCount, 1);
    assert.equal(result.errors.length, 0);

    assert.equal(await customerExists(EXPIRED_MAIN), false);

    const approvals = await db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.customerId, EXPIRED_MAIN));
    assert.equal(approvals.length, 0);

    const warningLogs = await db
      .select()
      .from(schema.reclamationWarningLogs)
      .where(eq(schema.reclamationWarningLogs.customerId, EXPIRED_MAIN));
    assert.equal(warningLogs.length, 0);

    const followUps = await db
      .select()
      .from(schema.followUps)
      .where(eq(schema.followUps.customerId, EXPIRED_MAIN));
    assert.equal(followUps.length, 0);

    const fieldLogs = await db
      .select()
      .from(schema.fieldChangeLogs)
      .where(eq(schema.fieldChangeLogs.customerId, EXPIRED_MAIN));
    assert.equal(fieldLogs.length, 0);

    const assignees = await db
      .select()
      .from(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, EXPIRED_MAIN));
    assert.equal(assignees.length, 0);

    const contacts = await db
      .select()
      .from(schema.customerContacts)
      .where(eq(schema.customerContacts.customerId, EXPIRED_MAIN));
    assert.equal(contacts.length, 0);

    const insights = await db
      .select()
      .from(schema.customerAiInsights)
      .where(eq(schema.customerAiInsights.customerId, EXPIRED_MAIN));
    assert.equal(insights.length, 0);

    // open task → cancelled (no longer pollutes dashboard KPI)
    const openTask = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, REL_TASK));
    assert.equal(openTask.length, 1);
    assert.equal(openTask[0]!.customerId, null);
    assert.equal(openTask[0]!.status, "cancelled");

    // completed task → still completed (not touched)
    const completedTask = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, REL_TASK_COMPLETED));
    assert.equal(completedTask.length, 1);
    assert.equal(completedTask[0]!.customerId, null);
    assert.equal(completedTask[0]!.status, "completed");

    // already-cancelled task → still cancelled (not touched)
    const cancelledTask = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, REL_TASK_CANCELLED));
    assert.equal(cancelledTask.length, 1);
    assert.equal(cancelledTask[0]!.customerId, null);
    assert.equal(cancelledTask[0]!.status, "cancelled");

    const notifications = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, REL_NOTIFICATION));
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]!.relatedEntityType, "customer");
    assert.equal(notifications[0]!.relatedEntityId, EXPIRED_MAIN);

    const auditRows = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, EXPIRED_MAIN),
          eq(schema.auditLogs.action, "customer.deleted.permanent"),
        ),
      );
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0]!.userId, null);

    const metadata = JSON.parse(auditRows[0]!.metadata ?? "{}") as {
      source?: string;
      deletedAt?: string;
      customerName?: string;
      customerId?: string;
      customerCode?: string | null;
      deletedReason?: string | null;
    };
    assert.equal(metadata.source, "cron");
    assert.equal(metadata.deletedAt, EXPIRED_DELETED_AT);
    assert.equal(metadata.customerName, "Purge Relations Main");
    assert.equal(metadata.customerId, EXPIRED_MAIN);
    assert.equal(metadata.customerCode, "EF-PURGE-01");
    assert.equal(metadata.deletedReason, "超期回收站清理");
  });

  it("E: does not purge customer deleted within 90 days", async () => {
    await deleteTestData();

    await upsertCustomer(
      makeCustomer({
        id: WITHIN_90,
        customerName: "Within 90 Days",
        deletedAt: WITHIN_90_DELETED_AT,
      }),
    );

    const result = await purgeExpiredRecycleBinCustomers(db, { now: FIXED_NOW });
    assert.equal(result.deletedCount, 0);
    assert.equal(await customerExists(WITHIN_90), true);
  });

  it("E: does not purge non-archived customer even with old deletedAt", async () => {
    await deleteTestData();

    await upsertCustomer(
      makeCustomer({
        id: ACTIVE_NOT_ARCHIVED,
        customerName: "Active Not Archived",
        status: "active",
        deletedAt: EXPIRED_DELETED_AT,
      }),
    );

    const result = await purgeExpiredRecycleBinCustomers(db, { now: FIXED_NOW });
    assert.equal(result.deletedCount, 0);
    assert.equal(await customerExists(ACTIVE_NOT_ARCHIVED), true);
  });

  it("E: does not purge archived customer without deletedAt", async () => {
    await deleteTestData();

    await upsertCustomer(
      makeCustomer({
        id: ARCHIVED_NO_DELETED,
        customerName: "Archived Legacy",
        deletedAt: null,
        deletedBy: null,
        deletedReason: null,
      }),
    );

    const result = await purgeExpiredRecycleBinCustomers(db, { now: FIXED_NOW });
    assert.equal(result.deletedCount, 0);
    assert.equal(await customerExists(ARCHIVED_NO_DELETED), true);
  });

  it("F: respects batch size when more than batchSize customers are eligible", async () => {
    await deleteTestData();

    await upsertCustomer(
      makeCustomer({
        id: BATCH_EXPIRED_1,
        customerName: "Batch Expired 1",
        deletedAt: "2026-01-01T12:00:00.000Z",
      }),
    );
    await upsertCustomer(
      makeCustomer({
        id: BATCH_EXPIRED_2,
        customerName: "Batch Expired 2",
        deletedAt: "2026-02-01T12:00:00.000Z",
      }),
    );
    await upsertCustomer(
      makeCustomer({
        id: BATCH_EXPIRED_3,
        customerName: "Batch Expired 3",
        deletedAt: "2026-03-01T12:00:00.000Z",
      }),
    );

    const result = await purgeExpiredRecycleBinCustomers(db, {
      now: FIXED_NOW,
      batchSize: 2,
    });

    assert.equal(result.scannedCount, 2);
    assert.equal(result.deletedCount, 2);

    const remaining = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(inArray(schema.customers.id, ALL_CUSTOMER_IDS));

    assert.equal(remaining.length, 1);
  });
});
