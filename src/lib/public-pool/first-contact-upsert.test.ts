import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { listCustomerAssignees } from "@/lib/customers/assignees";
import { getCustomerById } from "@/lib/customers/queries";
import { claimCustomerFromPool } from "@/lib/public-pool/service";
import { upsertFirstContactTaskForClaim } from "@/lib/tasks/first-contact";

const TEST_CUSTOMER_A = "c1111111-1111-1111-1111-1111111111c1";
const TEST_CUSTOMER_B = "c1111111-1111-1111-1111-1111111111c2";
const TASK_OLD = "c1111111-1111-1111-1111-1111111111t1";
const TASK_NEW = "c1111111-1111-1111-1111-1111111111t2";
const TASK_FOLLOW = "c1111111-1111-1111-1111-1111111111t3";
const TASK_OTHER_CUSTOMER = "c1111111-1111-1111-1111-1111111111t4";
const TASK_COMPLETED = "c1111111-1111-1111-1111-1111111111t5";
const TASK_CANCELLED = "c1111111-1111-1111-1111-1111111111t6";

const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;
const FIXED_NOW = "2026-07-30T12:00:00.000Z";
const EARLIER = "2026-07-29T12:00:00.000Z";
const LATER = "2026-07-30T18:00:00.000Z";

let db: ReturnType<typeof drizzle<typeof schema>>;
let dispose: (() => Promise<void>) | undefined;

function makePoolCustomer(
  id: string,
  overrides: Partial<Customer> = {},
): Customer {
  return {
    id,
    customerCode: null,
    customerName: `[TEST] First contact ${id.slice(-2)}`,
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000111",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    notes: null,
    salesStage: "new_lead",
    ownerId: null,
    status: "public_pool",
    releaserUserId: null,
    poolEnteredAt: FIXED_NOW,
    poolReason: "test",
    releasedBy: null,
    previousOwnerId: SEED_IDS.staffA,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    createdBy: SEED_IDS.admin,
    updatedBy: SEED_IDS.admin,
    lastFollowUpAt: null,
    lastValidFollowUpAt: null,
    nextFollowUpAt: null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: 0,
    pinnedAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  } as Customer;
}

async function cleanup() {
  const customerIds = [TEST_CUSTOMER_A, TEST_CUSTOMER_B];
  const taskIds = [
    TASK_OLD,
    TASK_NEW,
    TASK_FOLLOW,
    TASK_OTHER_CUSTOMER,
    TASK_COMPLETED,
    TASK_CANCELLED,
  ];
  await db.delete(schema.tasks).where(inArray(schema.tasks.id, taskIds));
  await db
    .delete(schema.tasks)
    .where(inArray(schema.tasks.customerId, customerIds));
  await db
    .delete(schema.customerAssignees)
    .where(inArray(schema.customerAssignees.customerId, customerIds));
  await db
    .delete(schema.auditLogs)
    .where(inArray(schema.auditLogs.entityId, customerIds));
  await db
    .delete(schema.customers)
    .where(inArray(schema.customers.id, customerIds));
}

async function latestAudit(entityId: string, action: string) {
  const rows = await db
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.entityId, entityId),
        eq(schema.auditLogs.action, action),
      ),
    )
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(1);
  const raw = rows[0]?.metadata;
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

describe("tasks Round B1-C1 first-contact upsert", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("inserts a new open first_contact when none exists", async () => {
    await cleanup();
    await db.insert(schema.customers).values(makePoolCustomer(TEST_CUSTOMER_A));

    const result = await upsertFirstContactTaskForClaim({
      db,
      customerId: TEST_CUSTOMER_A,
      actorId: SEED_IDS.staffB,
      customerName: "測試客戶",
      dueAt: LATER,
      now: FIXED_NOW,
    });

    assert.equal(result.createdNewTask, true);
    assert.equal(result.reusedExistingTask, false);
    assert.equal(result.deduplicatedExistingTasks, false);

    const tasks = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.customerId, TEST_CUSTOMER_A));
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.id, result.taskId);
    assert.equal(tasks[0]?.type, "first_contact");
    assert.equal(tasks[0]?.status, "open");
    assert.equal(tasks[0]?.assignedTo, SEED_IDS.staffB);
    assert.equal(tasks[0]?.createdBy, SEED_IDS.staffB);
    assert.equal(tasks[0]?.dueAt, LATER);
  });

  it("updates the existing open first_contact without inserting a second", async () => {
    await cleanup();
    await db.insert(schema.customers).values(makePoolCustomer(TEST_CUSTOMER_A));
    await db.insert(schema.tasks).values({
      id: TASK_OLD,
      customerId: TEST_CUSTOMER_A,
      assignedTo: SEED_IDS.staffA,
      createdBy: SEED_IDS.staffA,
      title: "舊標題",
      type: "first_contact",
      status: "open",
      dueAt: EARLIER,
      createdAt: EARLIER,
      updatedAt: EARLIER,
    });

    const result = await upsertFirstContactTaskForClaim({
      db,
      customerId: TEST_CUSTOMER_A,
      actorId: SEED_IDS.staffB,
      customerName: "測試客戶",
      dueAt: LATER,
      now: FIXED_NOW,
    });

    assert.equal(result.createdNewTask, false);
    assert.equal(result.reusedExistingTask, true);
    assert.equal(result.taskId, TASK_OLD);
    assert.equal(result.previousAssigneeId, SEED_IDS.staffA);
    assert.equal(result.dueAtChanged, true);

    const tasks = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.customerId, TEST_CUSTOMER_A));
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.id, TASK_OLD);
    assert.equal(tasks[0]?.assignedTo, SEED_IDS.staffB);
    assert.equal(tasks[0]?.createdBy, SEED_IDS.staffA);
    assert.equal(tasks[0]?.createdAt, EARLIER);
    assert.equal(tasks[0]?.dueAt, LATER);
    assert.equal(tasks[0]?.title, "首次联系客户：測試客戶");
    assert.equal(tasks[0]?.updatedAt, FIXED_NOW);
  });

  it("canonicalizes multiple open first_contact and cancels extras only", async () => {
    await cleanup();
    await db.insert(schema.customers).values([
      makePoolCustomer(TEST_CUSTOMER_A),
      makePoolCustomer(TEST_CUSTOMER_B, {
        customerName: "[TEST] Other",
        status: "active",
        ownerId: SEED_IDS.staffA,
        poolEnteredAt: null,
        poolReason: null,
      }),
    ]);

    await db.insert(schema.tasks).values([
      {
        id: TASK_NEW,
        customerId: TEST_CUSTOMER_A,
        assignedTo: SEED_IDS.staffA,
        createdBy: SEED_IDS.staffA,
        title: "較新",
        type: "first_contact",
        status: "open",
        dueAt: EARLIER,
        createdAt: LATER,
        updatedAt: LATER,
      },
      {
        id: TASK_OLD,
        customerId: TEST_CUSTOMER_A,
        assignedTo: SEED_IDS.staffA,
        createdBy: SEED_IDS.admin,
        title: "較舊 canonical",
        type: "first_contact",
        status: "open",
        dueAt: EARLIER,
        createdAt: EARLIER,
        updatedAt: EARLIER,
      },
      {
        id: TASK_FOLLOW,
        customerId: TEST_CUSTOMER_A,
        assignedTo: SEED_IDS.staffA,
        createdBy: SEED_IDS.staffA,
        title: "跟進",
        type: "follow_up",
        status: "open",
        dueAt: LATER,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      },
      {
        id: TASK_COMPLETED,
        customerId: TEST_CUSTOMER_A,
        assignedTo: SEED_IDS.staffA,
        createdBy: SEED_IDS.staffA,
        title: "完成",
        type: "first_contact",
        status: "completed",
        completedAt: EARLIER,
        dueAt: EARLIER,
        createdAt: EARLIER,
        updatedAt: EARLIER,
      },
      {
        id: TASK_CANCELLED,
        customerId: TEST_CUSTOMER_A,
        assignedTo: SEED_IDS.staffA,
        createdBy: SEED_IDS.staffA,
        title: "已取消",
        type: "first_contact",
        status: "cancelled",
        dueAt: EARLIER,
        createdAt: EARLIER,
        updatedAt: EARLIER,
      },
      {
        id: TASK_OTHER_CUSTOMER,
        customerId: TEST_CUSTOMER_B,
        assignedTo: SEED_IDS.staffA,
        createdBy: SEED_IDS.staffA,
        title: "他客",
        type: "first_contact",
        status: "open",
        dueAt: LATER,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      },
    ]);

    const result = await upsertFirstContactTaskForClaim({
      db,
      customerId: TEST_CUSTOMER_A,
      actorId: SEED_IDS.staffB,
      customerName: "測試客戶",
      dueAt: LATER,
      now: FIXED_NOW,
    });

    assert.equal(result.taskId, TASK_OLD);
    assert.equal(result.deduplicatedExistingTasks, true);

    const byId = Object.fromEntries(
      (
        await db
          .select()
          .from(schema.tasks)
          .where(
            inArray(schema.tasks.id, [
              TASK_OLD,
              TASK_NEW,
              TASK_FOLLOW,
              TASK_COMPLETED,
              TASK_CANCELLED,
              TASK_OTHER_CUSTOMER,
            ]),
          )
      ).map((row) => [row.id, row]),
    );

    assert.equal(byId[TASK_OLD]?.status, "open");
    assert.equal(byId[TASK_OLD]?.assignedTo, SEED_IDS.staffB);
    assert.equal(byId[TASK_OLD]?.createdBy, SEED_IDS.admin);
    assert.equal(byId[TASK_NEW]?.status, "cancelled");
    assert.equal(byId[TASK_FOLLOW]?.status, "open");
    assert.equal(byId[TASK_FOLLOW]?.type, "follow_up");
    assert.equal(byId[TASK_COMPLETED]?.status, "completed");
    assert.equal(byId[TASK_COMPLETED]?.completedAt, EARLIER);
    assert.equal(byId[TASK_CANCELLED]?.status, "cancelled");
    assert.equal(byId[TASK_OTHER_CUSTOMER]?.status, "open");

    const openFirst = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.customerId, TEST_CUSTOMER_A),
          eq(schema.tasks.type, "first_contact"),
          eq(schema.tasks.status, "open"),
        ),
      );
    assert.equal(openFirst.length, 1);
    assert.equal(openFirst[0]?.id, TASK_OLD);
  });

  it("claim creates first_contact and returns its taskId", async () => {
    await cleanup();
    const customer = makePoolCustomer(TEST_CUSTOMER_A);
    await db.insert(schema.customers).values(customer);

    const result = await claimCustomerFromPool(customer, staffB);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const tasks = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.customerId, TEST_CUSTOMER_A));
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.type, "first_contact");
    assert.equal(tasks[0]?.assignedTo, SEED_IDS.staffB);
    assert.equal(tasks[0]?.createdBy, SEED_IDS.staffB);
    assert.equal(tasks[0]?.id, result.taskId);

    const created = await latestAudit(result.taskId, "task.created.first_contact");
    assert.ok(created);
    assert.equal(created.customerId, TEST_CUSTOMER_A);
    assert.equal("title" in created, false);

    const claimMeta = await latestAudit(
      TEST_CUSTOMER_A,
      "customer.claimed_from_pool",
    );
    assert.ok(claimMeta);
    assert.equal(claimMeta.taskId, result.taskId);
  });

  it("re-claim after release reuses no open task and creates one open only", async () => {
    await cleanup();
    const customer = makePoolCustomer(TEST_CUSTOMER_A);
    await db.insert(schema.customers).values(customer);

    const first = await claimCustomerFromPool(customer, staffB);
    assert.equal(first.ok, true);
    if (!first.ok) return;

    // Simulate B1-B release cancel of open tasks + return to pool
    await db
      .update(schema.tasks)
      .set({ status: "cancelled", updatedAt: FIXED_NOW })
      .where(
        and(
          eq(schema.tasks.customerId, TEST_CUSTOMER_A),
          eq(schema.tasks.status, "open"),
        ),
      );
    await db
      .update(schema.customers)
      .set({
        ownerId: null,
        status: "public_pool",
        claimedBy: null,
        claimedAt: null,
        poolLeftAt: null,
        poolEnteredAt: FIXED_NOW,
        releasedBy: SEED_IDS.staffB,
        releaserUserId: SEED_IDS.staffB,
        previousOwnerId: SEED_IDS.staffB,
        updatedAt: FIXED_NOW,
      })
      .where(eq(schema.customers.id, TEST_CUSTOMER_A));
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, TEST_CUSTOMER_A));

    const poolCustomer = (await getCustomerById(TEST_CUSTOMER_A))!;
    const second = await claimCustomerFromPool(poolCustomer, staffA);
    assert.equal(second.ok, true);
    if (!second.ok) return;

    const openFirst = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.customerId, TEST_CUSTOMER_A),
          eq(schema.tasks.type, "first_contact"),
          eq(schema.tasks.status, "open"),
        ),
      );
    assert.equal(openFirst.length, 1);
    assert.equal(openFirst[0]?.id, second.taskId);
    assert.equal(openFirst[0]?.assignedTo, SEED_IDS.staffA);
    assert.notEqual(second.taskId, first.taskId);
  });

  it("claim updates existing open first_contact instead of inserting", async () => {
    await cleanup();
    const customer = makePoolCustomer(TEST_CUSTOMER_A);
    await db.insert(schema.customers).values(customer);
    await db.insert(schema.tasks).values({
      id: TASK_OLD,
      customerId: TEST_CUSTOMER_A,
      assignedTo: SEED_IDS.staffA,
      createdBy: SEED_IDS.admin,
      title: "殘留 open",
      type: "first_contact",
      status: "open",
      dueAt: EARLIER,
      createdAt: EARLIER,
      updatedAt: EARLIER,
    });

    const result = await claimCustomerFromPool(customer, staffB);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.taskId, TASK_OLD);

    const openFirst = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.customerId, TEST_CUSTOMER_A),
          eq(schema.tasks.type, "first_contact"),
          eq(schema.tasks.status, "open"),
        ),
      );
    assert.equal(openFirst.length, 1);
    assert.equal(openFirst[0]?.assignedTo, SEED_IDS.staffB);
    assert.equal(openFirst[0]?.createdBy, SEED_IDS.admin);

    const updatedAudit = await latestAudit(TASK_OLD, "task.updated");
    assert.ok(updatedAudit);
    assert.equal(updatedAudit.reasonCode, "public_pool_claim");
    assert.equal(updatedAudit.reusedExistingTask, true);
    assert.equal("title" in updatedAudit, false);
  });

  it("rolls back customer and assignees when first-contact upsert fails", async () => {
    await cleanup();
    const customer = makePoolCustomer(TEST_CUSTOMER_A);
    await db.insert(schema.customers).values(customer);

    await assert.rejects(
      () =>
        claimCustomerFromPool(customer, staffB, {
          upsertFirstContactTask: async () => {
            throw new Error("forced upsert failure");
          },
        }),
      /forced upsert failure/,
    );

    const updated = await getCustomerById(TEST_CUSTOMER_A);
    assert.ok(updated);
    assert.equal(updated.status, "public_pool");
    assert.equal(updated.ownerId, null);
    assert.equal(updated.claimedBy, null);
    assert.equal(updated.claimedAt, null);

    const assignees = await listCustomerAssignees(db, TEST_CUSTOMER_A);
    assert.equal(assignees.length, 0);

    const tasks = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.customerId, TEST_CUSTOMER_A));
    assert.equal(tasks.length, 0);
  });

  it("claim loser does not create tasks or mutate the winner", async () => {
    await cleanup();
    const customer = makePoolCustomer(TEST_CUSTOMER_A);
    await db.insert(schema.customers).values(customer);

    const first = await claimCustomerFromPool(customer, staffB);
    assert.equal(first.ok, true);

    const second = await claimCustomerFromPool(customer, staffA);
    assert.equal(second.ok, false);

    const updated = await getCustomerById(TEST_CUSTOMER_A);
    assert.equal(updated?.ownerId, SEED_IDS.staffB);

    const openFirst = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.customerId, TEST_CUSTOMER_A),
          eq(schema.tasks.type, "first_contact"),
          eq(schema.tasks.status, "open"),
        ),
      );
    assert.equal(openFirst.length, 1);
    assert.equal(openFirst[0]?.assignedTo, SEED_IDS.staffB);
  });
});
