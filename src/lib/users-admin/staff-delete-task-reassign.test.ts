import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { softDeleteUserAccount } from "@/lib/users-admin/service";
import { buildReassignOpenTasksForAssigneeStatement } from "@/lib/tasks/lifecycle";

const STAFF_ID = "b1a00000-aaaa-4111-8111-111111111101";
const STAFF_EMAIL = "b1a-reassign-staff@crm.test.local";
const OTHER_STAFF_ID = SEED_IDS.staffA;
const ADMIN_ID = SEED_IDS.admin;

const CUST_OWNED = "b1a00000-aaaa-4111-8111-111111111201";
const CUST_OTHER_OWNER = "b1a00000-aaaa-4111-8111-111111111202";
const CUST_ADMIN_OWNER = "b1a00000-aaaa-4111-8111-111111111203";
const CUST_POOL = "b1a00000-aaaa-4111-8111-111111111204";
const CUST_ARCHIVED = "b1a00000-aaaa-4111-8111-111111111205";

const TASK_FOLLOW_UP = "b1a00000-aaaa-4111-8111-111111111301";
const TASK_FIRST_CONTACT = "b1a00000-aaaa-4111-8111-111111111302";
const TASK_OTHER = "b1a00000-aaaa-4111-8111-111111111303";
const TASK_NULL_CUSTOMER = "b1a00000-aaaa-4111-8111-111111111304";
const TASK_OTHER_OWNER = "b1a00000-aaaa-4111-8111-111111111305";
const TASK_ADMIN_OWNER = "b1a00000-aaaa-4111-8111-111111111306";
const TASK_POOL = "b1a00000-aaaa-4111-8111-111111111307";
const TASK_ARCHIVED = "b1a00000-aaaa-4111-8111-111111111308";
const TASK_OVERDUE = "b1a00000-aaaa-4111-8111-111111111309";
const TASK_NO_DUE = "b1a00000-aaaa-4111-8111-111111111310";
const TASK_COMPLETED = "b1a00000-aaaa-4111-8111-111111111311";
const TASK_CANCELLED = "b1a00000-aaaa-4111-8111-111111111312";
const TASK_OTHER_ASSIGNEE = "b1a00000-aaaa-4111-8111-111111111313";

let db: ReturnType<typeof drizzle<typeof schema>>;
let adminUser: User;
let disposeProxy: (() => Promise<void>) | undefined;

function makeCustomer(
  overrides: Partial<Customer> & Pick<Customer, "id" | "customerName">,
): Customer {
  const now = "2026-07-31T08:00:00.000Z";
  return {
    customerCode: null,
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13900001111",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    notes: null,
    salesStage: "new_lead",
    status: "active",
    ownerId: STAFF_ID,
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
    createdBy: STAFF_ID,
    updatedBy: STAFF_ID,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    ...overrides,
  } as Customer;
}

async function cleanupFixtures() {
  const taskIds = [
    TASK_FOLLOW_UP,
    TASK_FIRST_CONTACT,
    TASK_OTHER,
    TASK_NULL_CUSTOMER,
    TASK_OTHER_OWNER,
    TASK_ADMIN_OWNER,
    TASK_POOL,
    TASK_ARCHIVED,
    TASK_OVERDUE,
    TASK_NO_DUE,
    TASK_COMPLETED,
    TASK_CANCELLED,
    TASK_OTHER_ASSIGNEE,
  ];
  for (const id of taskIds) {
    await db.delete(schema.tasks).where(eq(schema.tasks.id, id));
  }
  const customerIds = [
    CUST_OWNED,
    CUST_OTHER_OWNER,
    CUST_ADMIN_OWNER,
    CUST_POOL,
    CUST_ARCHIVED,
  ];
  for (const id of customerIds) {
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, id));
    await db
      .delete(schema.fieldChangeLogs)
      .where(eq(schema.fieldChangeLogs.customerId, id));
    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, id));
    await db.delete(schema.customers).where(eq(schema.customers.id, id));
  }
  await db
    .delete(schema.auditLogs)
    .where(eq(schema.auditLogs.entityId, STAFF_ID));
  await db
    .delete(schema.sessions)
    .where(eq(schema.sessions.userId, STAFF_ID));
  await db.delete(schema.users).where(eq(schema.users.id, STAFF_ID));
}

async function ensureStaff() {
  const now = "2026-07-31T08:00:00.000Z";
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, STAFF_ID))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(schema.users).values({
      id: STAFF_ID,
      email: STAFF_EMAIL,
      passwordHash: "INVALID_HASH_TEST_ONLY",
      displayName: "B1A Reassign Staff",
      role: "staff",
      isActive: 1,
      failedLoginAttempts: 0,
      lockedUntil: null,
      mustChangePassword: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  } else {
    await db
      .update(schema.users)
      .set({ isActive: 1, deletedAt: null, updatedAt: now })
      .where(eq(schema.users.id, STAFF_ID));
  }
}

async function insertTask(input: {
  id: string;
  customerId: string | null;
  assignedTo: string;
  createdBy: string;
  type: "follow_up" | "first_contact" | "other";
  status: "open" | "completed" | "cancelled";
  dueAt: string | null;
  completedAt: string | null;
  title: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}) {
  await db.insert(schema.tasks).values({
    id: input.id,
    customerId: input.customerId,
    assignedTo: input.assignedTo,
    createdBy: input.createdBy,
    title: input.title,
    description: input.description,
    type: input.type,
    status: input.status,
    dueAt: input.dueAt,
    completedAt: input.completedAt,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  });
}

describe("tasks Round B1-A staff delete open-task reassignment", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({
      configPath: new URL("../../../wrangler.jsonc", import.meta.url).pathname,
    });
    disposeProxy = () => proxy.dispose();
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);

    const adminRows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, ADMIN_ID))
      .limit(1);
    assert.ok(adminRows[0], "seed admin required");
    adminUser = adminRows[0]!;
  });

  after(async () => {
    await cleanupFixtures();
    if (disposeProxy) await disposeProxy();
  });

  it("reassigns all open tasks for deleted staff to actor admin and preserves other rows", async () => {
    await cleanupFixtures();
    await ensureStaff();

    const createdAt = "2026-07-01T00:00:00.000Z";
    const updatedAt = "2026-07-10T00:00:00.000Z";
    const overdueDue = "2026-06-01T00:00:00.000Z";
    const completedAt = "2026-07-05T00:00:00.000Z";

    await db.insert(schema.customers).values(
      makeCustomer({
        id: CUST_OWNED,
        customerName: "B1A Owned",
        ownerId: STAFF_ID,
        status: "active",
      }),
    );
    await db.insert(schema.customers).values(
      makeCustomer({
        id: CUST_OTHER_OWNER,
        customerName: "B1A Other Owner",
        ownerId: OTHER_STAFF_ID,
        status: "active",
        createdBy: OTHER_STAFF_ID,
        updatedBy: OTHER_STAFF_ID,
      }),
    );
    await db.insert(schema.customers).values(
      makeCustomer({
        id: CUST_ADMIN_OWNER,
        customerName: "B1A Admin Owner",
        ownerId: ADMIN_ID,
        status: "active",
        createdBy: ADMIN_ID,
        updatedBy: ADMIN_ID,
      }),
    );
    await db.insert(schema.customers).values(
      makeCustomer({
        id: CUST_POOL,
        customerName: "B1A Pool",
        ownerId: null,
        status: "public_pool",
        poolEnteredAt: createdAt,
        poolReason: "b1a fixture",
        createdBy: ADMIN_ID,
        updatedBy: ADMIN_ID,
      }),
    );
    await db.insert(schema.customers).values(
      makeCustomer({
        id: CUST_ARCHIVED,
        customerName: "B1A Archived",
        ownerId: STAFF_ID,
        status: "archived",
        deletedAt: createdAt,
        deletedBy: ADMIN_ID,
      }),
    );

    await insertTask({
      id: TASK_FOLLOW_UP,
      customerId: CUST_OWNED,
      assignedTo: STAFF_ID,
      createdBy: STAFF_ID,
      type: "follow_up",
      status: "open",
      dueAt: "2026-08-01T00:00:00.000Z",
      completedAt: null,
      title: "follow up title",
      description: "follow up desc",
      createdAt,
      updatedAt,
    });
    await insertTask({
      id: TASK_FIRST_CONTACT,
      customerId: CUST_OWNED,
      assignedTo: STAFF_ID,
      createdBy: ADMIN_ID,
      type: "first_contact",
      status: "open",
      dueAt: "2026-08-02T00:00:00.000Z",
      completedAt: null,
      title: "first contact title",
      description: null,
      createdAt,
      updatedAt,
    });
    await insertTask({
      id: TASK_OTHER,
      customerId: CUST_OWNED,
      assignedTo: STAFF_ID,
      createdBy: STAFF_ID,
      type: "other",
      status: "open",
      dueAt: "2026-08-03T00:00:00.000Z",
      completedAt: null,
      title: "other title",
      description: "other desc",
      createdAt,
      updatedAt,
    });
    await insertTask({
      id: TASK_NULL_CUSTOMER,
      customerId: null,
      assignedTo: STAFF_ID,
      createdBy: STAFF_ID,
      type: "other",
      status: "open",
      dueAt: null,
      completedAt: null,
      title: "null customer title",
      description: null,
      createdAt,
      updatedAt,
    });
    await insertTask({
      id: TASK_OTHER_OWNER,
      customerId: CUST_OTHER_OWNER,
      assignedTo: STAFF_ID,
      createdBy: OTHER_STAFF_ID,
      type: "follow_up",
      status: "open",
      dueAt: "2026-08-04T00:00:00.000Z",
      completedAt: null,
      title: "other owner title",
      description: null,
      createdAt,
      updatedAt,
    });
    await insertTask({
      id: TASK_ADMIN_OWNER,
      customerId: CUST_ADMIN_OWNER,
      assignedTo: STAFF_ID,
      createdBy: ADMIN_ID,
      type: "follow_up",
      status: "open",
      dueAt: "2026-08-05T00:00:00.000Z",
      completedAt: null,
      title: "admin owner title",
      description: null,
      createdAt,
      updatedAt,
    });
    await insertTask({
      id: TASK_POOL,
      customerId: CUST_POOL,
      assignedTo: STAFF_ID,
      createdBy: STAFF_ID,
      type: "follow_up",
      status: "open",
      dueAt: "2026-08-06T00:00:00.000Z",
      completedAt: null,
      title: "pool title",
      description: null,
      createdAt,
      updatedAt,
    });
    await insertTask({
      id: TASK_ARCHIVED,
      customerId: CUST_ARCHIVED,
      assignedTo: STAFF_ID,
      createdBy: STAFF_ID,
      type: "follow_up",
      status: "open",
      dueAt: "2026-08-07T00:00:00.000Z",
      completedAt: null,
      title: "archived title",
      description: null,
      createdAt,
      updatedAt,
    });
    await insertTask({
      id: TASK_OVERDUE,
      customerId: CUST_OWNED,
      assignedTo: STAFF_ID,
      createdBy: STAFF_ID,
      type: "follow_up",
      status: "open",
      dueAt: overdueDue,
      completedAt: null,
      title: "overdue title",
      description: null,
      createdAt,
      updatedAt,
    });
    await insertTask({
      id: TASK_NO_DUE,
      customerId: CUST_OWNED,
      assignedTo: STAFF_ID,
      createdBy: STAFF_ID,
      type: "follow_up",
      status: "open",
      dueAt: null,
      completedAt: null,
      title: "no due title",
      description: null,
      createdAt,
      updatedAt,
    });
    await insertTask({
      id: TASK_COMPLETED,
      customerId: CUST_OWNED,
      assignedTo: STAFF_ID,
      createdBy: STAFF_ID,
      type: "follow_up",
      status: "completed",
      dueAt: "2026-07-04T00:00:00.000Z",
      completedAt,
      title: "completed title",
      description: "completed desc",
      createdAt,
      updatedAt,
    });
    await insertTask({
      id: TASK_CANCELLED,
      customerId: CUST_OWNED,
      assignedTo: STAFF_ID,
      createdBy: STAFF_ID,
      type: "follow_up",
      status: "cancelled",
      dueAt: "2026-07-04T00:00:00.000Z",
      completedAt: null,
      title: "cancelled title",
      description: null,
      createdAt,
      updatedAt,
    });
    await insertTask({
      id: TASK_OTHER_ASSIGNEE,
      customerId: CUST_OWNED,
      assignedTo: OTHER_STAFF_ID,
      createdBy: STAFF_ID,
      type: "follow_up",
      status: "open",
      dueAt: "2026-08-08T00:00:00.000Z",
      completedAt: null,
      title: "other assignee title",
      description: null,
      createdAt,
      updatedAt,
    });

    const beforeCompleted = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, TASK_COMPLETED))
      .limit(1);
    const beforeCancelled = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, TASK_CANCELLED))
      .limit(1);
    const beforeOtherAssignee = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, TASK_OTHER_ASSIGNEE))
      .limit(1);

    await softDeleteUserAccount(adminUser, STAFF_ID, {});

    const openExpected = [
      TASK_FOLLOW_UP,
      TASK_FIRST_CONTACT,
      TASK_OTHER,
      TASK_NULL_CUSTOMER,
      TASK_OTHER_OWNER,
      TASK_ADMIN_OWNER,
      TASK_POOL,
      TASK_ARCHIVED,
      TASK_OVERDUE,
      TASK_NO_DUE,
    ];

    for (const id of openExpected) {
      const rows = await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, id))
        .limit(1);
      const row = rows[0]!;
      assert.equal(row.assignedTo, ADMIN_ID, id);
      assert.equal(row.status, "open", id);
      assert.equal(row.createdAt, createdAt, id);
      assert.notEqual(row.updatedAt, updatedAt, id);
    }

    const followUp = (
      await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, TASK_FOLLOW_UP))
        .limit(1)
    )[0]!;
    assert.equal(followUp.createdBy, STAFF_ID);
    assert.equal(followUp.dueAt, "2026-08-01T00:00:00.000Z");
    assert.equal(followUp.title, "follow up title");
    assert.equal(followUp.description, "follow up desc");
    assert.equal(followUp.customerId, CUST_OWNED);
    assert.equal(followUp.completedAt, null);
    assert.equal(followUp.id, TASK_FOLLOW_UP);

    const firstContact = (
      await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, TASK_FIRST_CONTACT))
        .limit(1)
    )[0]!;
    assert.equal(firstContact.createdBy, ADMIN_ID);

    const nullCustomer = (
      await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, TASK_NULL_CUSTOMER))
        .limit(1)
    )[0]!;
    assert.equal(nullCustomer.customerId, null);

    const overdue = (
      await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, TASK_OVERDUE))
        .limit(1)
    )[0]!;
    assert.equal(overdue.dueAt, overdueDue);

    const noDue = (
      await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, TASK_NO_DUE))
        .limit(1)
    )[0]!;
    assert.equal(noDue.dueAt, null);

    const completed = (
      await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, TASK_COMPLETED))
        .limit(1)
    )[0]!;
    assert.equal(completed.assignedTo, STAFF_ID);
    assert.equal(completed.status, "completed");
    assert.equal(completed.completedAt, completedAt);
    assert.equal(completed.updatedAt, beforeCompleted[0]!.updatedAt);
    assert.equal(completed.title, "completed title");

    const cancelled = (
      await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, TASK_CANCELLED))
        .limit(1)
    )[0]!;
    assert.equal(cancelled.assignedTo, STAFF_ID);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.updatedAt, beforeCancelled[0]!.updatedAt);

    const otherAssignee = (
      await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, TASK_OTHER_ASSIGNEE))
        .limit(1)
    )[0]!;
    assert.equal(otherAssignee.assignedTo, OTHER_STAFF_ID);
    assert.equal(otherAssignee.updatedAt, beforeOtherAssignee[0]!.updatedAt);

    const remainingOpenOnStaff = await db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.assignedTo, STAFF_ID),
          eq(schema.tasks.status, "open"),
        ),
      );
    assert.equal(remainingOpenOnStaff.length, 0);

    const deletionAudits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, "user.deleted"),
          eq(schema.auditLogs.entityId, STAFF_ID),
        ),
      );
    assert.ok(deletionAudits.length >= 1);
    const meta = JSON.parse(deletionAudits[deletionAudits.length - 1]!.metadata!);
    assert.equal(meta.taskReassignmentReasonCode, "staff_deleted");
    assert.equal(meta.previousAssigneeId, STAFF_ID);
    assert.equal(meta.nextAssigneeId, ADMIN_ID);
    assert.equal(meta.taskCount, undefined);
    assert.equal(meta.openTasksCount, undefined);
    assert.equal(meta.taskIds, undefined);
    assert.equal(meta.title, undefined);
    assert.equal(meta.description, undefined);
    assert.equal(meta.phone, undefined);

    // Idempotent helper: second run affects zero open rows for previous assignee.
    await buildReassignOpenTasksForAssigneeStatement(db, {
      previousAssigneeId: STAFF_ID,
      nextAssigneeId: ADMIN_ID,
      updatedAt: "2026-07-31T12:00:00.000Z",
    });
    const stillOpenOnStaff = await db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.assignedTo, STAFF_ID),
          eq(schema.tasks.status, "open"),
        ),
      );
    assert.equal(stillOpenOnStaff.length, 0);

    await cleanupFixtures();
  });
});
