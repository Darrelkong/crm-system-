import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { APPROVAL_AUDIT_ACTIONS } from "./constants";
import { approveApprovalRequest } from "./service";
import { buildTransferPrimaryAssigneeStatements } from "@/lib/customers/transfer-primary-assignee";

type Db = ReturnType<typeof drizzle<typeof schema>>;

// Owner A / target B are seed staff; collaborator C reuses the seed admin so we
// never have to create or tear down extra users.
const USER_A = SEED_IDS.staffA; // current owner
const USER_B = SEED_IDS.staffB; // transfer target
const USER_C = SEED_IDS.admin; // an unrelated collaborator to be preserved
const reviewer = { id: SEED_IDS.admin, role: "admin" } as User;

const CUST_BASE = "cccccccc-0000-0000-0000-000000000001";
const CUST_UPGRADE = "cccccccc-0000-0000-0000-000000000002";
const CUST_MISSING = "cccccccc-0000-0000-0000-000000000003";
const CUST_POOL = "cccccccc-0000-0000-0000-000000000004";
const CUST_ATOMIC = "cccccccc-0000-0000-0000-000000000005";

const ALL_CUSTOMER_IDS = [
  CUST_BASE,
  CUST_UPGRADE,
  CUST_MISSING,
  CUST_POOL,
  CUST_ATOMIC,
];

const ATOMIC_MARKER_ASSIGNEE_ID = "cccccccc-dup-collab-marker-0000";

function insertCustomer(
  db: Db,
  input: {
    id: string;
    ownerId: string | null;
    status: "active" | "public_pool";
    now: string;
  },
) {
  return db.insert(schema.customers).values({
    id: input.id,
    customerCode: `TFR-${input.id.slice(-4)}`,
    customerName: "转移测试客户",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: null,
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    notes: null,
    salesStage: "new_lead",
    status: input.status,
    ownerId: input.ownerId,
    createdBy: USER_A,
    updatedBy: USER_A,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

function insertAssignee(
  db: Db,
  input: {
    id?: string;
    customerId: string;
    userId: string;
    role: "primary" | "collaborator";
    assignedBy: string;
    now: string;
  },
) {
  return db.insert(schema.customerAssignees).values({
    id: input.id ?? `ca_${input.customerId}_${input.userId}`,
    customerId: input.customerId,
    userId: input.userId,
    role: input.role,
    assignedBy: input.assignedBy,
    assignedAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

async function insertTransferApproval(
  db: Db,
  input: { customerId: string; targetUserId: string; now: string },
): Promise<string> {
  const id = `appr-transfer-${input.customerId.slice(-4)}-${Date.now()}`;
  await db.insert(schema.approvals).values({
    id,
    requestType: "transfer_customer",
    status: "pending",
    customerId: input.customerId,
    requestedBy: USER_A,
    targetUserId: input.targetUserId,
    reason: "转移测试",
    createdAt: input.now,
    updatedAt: input.now,
  });
  return id;
}

async function assigneesFor(db: Db, customerId: string) {
  return db
    .select()
    .from(schema.customerAssignees)
    .where(eq(schema.customerAssignees.customerId, customerId));
}

async function customerRow(db: Db, customerId: string) {
  const rows = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1);
  return rows[0];
}

async function cleanup(db: Db) {
  for (const customerId of ALL_CUSTOMER_IDS) {
    await db
      .delete(schema.fieldChangeLogs)
      .where(eq(schema.fieldChangeLogs.customerId, customerId));
    await db.delete(schema.tasks).where(eq(schema.tasks.customerId, customerId));
    await db
      .delete(schema.approvals)
      .where(eq(schema.approvals.customerId, customerId));
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, customerId));
    await db
      .delete(schema.notifications)
      .where(eq(schema.notifications.relatedEntityId, customerId));
    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, customerId));
    await db.delete(schema.customers).where(eq(schema.customers.id, customerId));
  }
}

describe("transfer_customer approval — owner ⇔ primary sync", () => {
  let db: Db;
  let dispose: (() => Promise<void>) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    await cleanup(db);
  });

  after(async () => {
    await cleanup(db);
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("moves primary A→B, preserves collaborator C, keeps side effects", async () => {
    const now = "2026-07-19T14:00:00.000Z";
    await insertCustomer(db, {
      id: CUST_BASE,
      ownerId: USER_A,
      status: "active",
      now,
    });
    await insertAssignee(db, {
      customerId: CUST_BASE,
      userId: USER_A,
      role: "primary",
      assignedBy: USER_A,
      now,
    });
    await insertAssignee(db, {
      customerId: CUST_BASE,
      userId: USER_C,
      role: "collaborator",
      assignedBy: USER_A,
      now,
    });
    // Open task assigned to previous owner A → should be reassigned to B.
    await db.insert(schema.tasks).values({
      id: `task-${CUST_BASE}`,
      customerId: CUST_BASE,
      assignedTo: USER_A,
      createdBy: USER_A,
      title: "跟进任务",
      type: "follow_up",
      status: "open",
      createdAt: now,
      updatedAt: now,
    });

    const approvalId = await insertTransferApproval(db, {
      customerId: CUST_BASE,
      targetUserId: USER_B,
      now,
    });

    await approveApprovalRequest(approvalId, reviewer);

    const customer = await customerRow(db, CUST_BASE);
    assert.equal(customer?.ownerId, USER_B, "owner should be B");

    const rows = await assigneesFor(db, CUST_BASE);
    const primaries = rows.filter((r) => r.role === "primary");
    assert.equal(primaries.length, 1, "exactly one primary");
    assert.equal(primaries[0]?.userId, USER_B, "primary is B");
    assert.equal(primaries[0]?.assignedBy, reviewer.id, "assignedBy is reviewer");
    assert.equal(
      rows.some((r) => r.userId === USER_A),
      false,
      "old primary A removed",
    );
    assert.equal(
      rows.some((r) => r.userId === USER_C && r.role === "collaborator"),
      true,
      "collaborator C preserved",
    );

    // Side effects unchanged.
    const task = await db
      .select({ assignedTo: schema.tasks.assignedTo })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, `task-${CUST_BASE}`))
      .limit(1);
    assert.equal(task[0]?.assignedTo, USER_B, "open task reassigned to B");

    const fcl = await db
      .select({ id: schema.fieldChangeLogs.id })
      .from(schema.fieldChangeLogs)
      .where(
        and(
          eq(schema.fieldChangeLogs.customerId, CUST_BASE),
          eq(schema.fieldChangeLogs.fieldName, "owner_id"),
        ),
      );
    assert.ok(fcl.length > 0, "owner_id field change log written");

    const audit = await db
      .select({ id: schema.auditLogs.id })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, CUST_BASE),
          eq(schema.auditLogs.action, APPROVAL_AUDIT_ACTIONS.customerTransferred),
        ),
      );
    assert.ok(audit.length > 0, "transfer audit log written");

    const notif = await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.relatedEntityId, CUST_BASE),
          eq(schema.notifications.userId, USER_B),
          eq(schema.notifications.type, "customer.transferred"),
        ),
      );
    assert.ok(notif.length > 0, "target B notified of transfer");
  });

  it("upgrades target B from collaborator to primary without duplicate rows", async () => {
    const now = "2026-07-19T14:05:00.000Z";
    await insertCustomer(db, {
      id: CUST_UPGRADE,
      ownerId: USER_A,
      status: "active",
      now,
    });
    await insertAssignee(db, {
      customerId: CUST_UPGRADE,
      userId: USER_A,
      role: "primary",
      assignedBy: USER_A,
      now,
    });
    await insertAssignee(db, {
      customerId: CUST_UPGRADE,
      userId: USER_B,
      role: "collaborator",
      assignedBy: USER_A,
      now,
    });
    await insertAssignee(db, {
      customerId: CUST_UPGRADE,
      userId: USER_C,
      role: "collaborator",
      assignedBy: USER_A,
      now,
    });

    const approvalId = await insertTransferApproval(db, {
      customerId: CUST_UPGRADE,
      targetUserId: USER_B,
      now,
    });
    await approveApprovalRequest(approvalId, reviewer);

    const rows = await assigneesFor(db, CUST_UPGRADE);
    const bRows = rows.filter((r) => r.userId === USER_B);
    assert.equal(bRows.length, 1, "target B has exactly one row (no duplicate)");
    assert.equal(bRows[0]?.role, "primary", "B upgraded to primary");
    assert.equal(
      rows.filter((r) => r.role === "primary").length,
      1,
      "exactly one primary",
    );
    assert.equal(
      rows.some((r) => r.userId === USER_C && r.role === "collaborator"),
      true,
      "collaborator C preserved",
    );
  });

  it("creates B primary even when the customer had no primary row", async () => {
    const now = "2026-07-19T14:10:00.000Z";
    await insertCustomer(db, {
      id: CUST_MISSING,
      ownerId: USER_A,
      status: "active",
      now,
    });
    // No primary row — only a collaborator (simulates the pre-fix missing-primary bug).
    await insertAssignee(db, {
      customerId: CUST_MISSING,
      userId: USER_C,
      role: "collaborator",
      assignedBy: USER_A,
      now,
    });

    const approvalId = await insertTransferApproval(db, {
      customerId: CUST_MISSING,
      targetUserId: USER_B,
      now,
    });
    await approveApprovalRequest(approvalId, reviewer);

    const rows = await assigneesFor(db, CUST_MISSING);
    const primaries = rows.filter((r) => r.role === "primary");
    assert.equal(primaries.length, 1, "exactly one primary created");
    assert.equal(primaries[0]?.userId, USER_B, "primary is B");
    assert.equal(
      rows.some((r) => r.userId === USER_C && r.role === "collaborator"),
      true,
      "collaborator C preserved",
    );
  });

  it("public_pool transfer sets status=active, owner=B, primary=B", async () => {
    const now = "2026-07-19T14:15:00.000Z";
    await insertCustomer(db, {
      id: CUST_POOL,
      ownerId: null,
      status: "public_pool",
      now,
    });
    // Public pool customers hold no assignees.

    const approvalId = await insertTransferApproval(db, {
      customerId: CUST_POOL,
      targetUserId: USER_B,
      now,
    });
    await approveApprovalRequest(approvalId, reviewer);

    const customer = await customerRow(db, CUST_POOL);
    assert.equal(customer?.status, "active", "status becomes active");
    assert.equal(customer?.ownerId, USER_B, "owner becomes B");

    const rows = await assigneesFor(db, CUST_POOL);
    const primaries = rows.filter((r) => r.role === "primary");
    assert.equal(primaries.length, 1, "exactly one primary");
    assert.equal(primaries[0]?.userId, USER_B, "primary is B");
  });

  it("atomicity: when an assignee write fails, the owner update is rolled back", async () => {
    const now = "2026-07-19T14:20:00.000Z";
    await insertCustomer(db, {
      id: CUST_ATOMIC,
      ownerId: USER_A,
      status: "active",
      now,
    });
    await insertAssignee(db, {
      customerId: CUST_ATOMIC,
      userId: USER_A,
      role: "primary",
      assignedBy: USER_A,
      now,
    });
    // Marker collaborator row (user C) with a fixed id we will collide against.
    // The transfer helper only deletes role=primary and userId=target(B) rows,
    // so this marker survives the helper deletes and remains available for a
    // deterministic PRIMARY KEY collision.
    await insertAssignee(db, {
      id: ATOMIC_MARKER_ASSIGNEE_ID,
      customerId: CUST_ATOMIC,
      userId: USER_C,
      role: "collaborator",
      assignedBy: USER_A,
      now,
    });

    // Reconstruct the exact statements the service batches for a transfer, then
    // append an assignee insert that reuses the marker id → guaranteed failure
    // on an assignee write. A correct atomic batch must roll back the owner
    // update too.
    const updateOwnerStmt = db
      .update(schema.customers)
      .set({ ownerId: USER_B, updatedBy: reviewer.id, updatedAt: now })
      .where(eq(schema.customers.id, CUST_ATOMIC));
    const primaryStmts = buildTransferPrimaryAssigneeStatements(db, {
      customerId: CUST_ATOMIC,
      targetUserId: USER_B,
      assignedBy: reviewer.id,
      now,
    });
    const failingAssigneeInsert = db.insert(schema.customerAssignees).values({
      id: ATOMIC_MARKER_ASSIGNEE_ID, // duplicate PK → forces batch failure
      customerId: CUST_ATOMIC,
      userId: USER_B,
      role: "collaborator",
      assignedBy: reviewer.id,
      assignedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await assert.rejects(async () => {
      await db.batch(
        [
          updateOwnerStmt,
          ...primaryStmts,
          failingAssigneeInsert,
        ] as unknown as Parameters<typeof db.batch>[0],
      );
    });

    const customer = await customerRow(db, CUST_ATOMIC);
    assert.equal(customer?.ownerId, USER_A, "owner must remain A after rollback");

    const rows = await assigneesFor(db, CUST_ATOMIC);
    const primaries = rows.filter((r) => r.role === "primary");
    assert.equal(primaries.length, 1, "still exactly one primary");
    assert.equal(primaries[0]?.userId, USER_A, "primary still A after rollback");
  });
});
