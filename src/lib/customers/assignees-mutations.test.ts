import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { listCustomerAssignees } from "./assignees";
import {
  applyCollaboratorAssignees,
  AssigneeMutationError,
} from "./assignees-mutations";
import {
  canManageCustomerAssignees,
  PermissionError,
} from "@/lib/permissions/customers";

const CUSTOMER_ID = SEED_IDS.customerStaffA;
const MISSING_USER_ID = "00000000-0000-0000-0000-000000000099";

const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;

function makeCustomer(overrides: Partial<Customer> & Pick<Customer, "id">): Customer {
  const now = "2026-06-28T12:00:00.000Z";
  return {
    customerCode: "EF-100",
    customerName: "测试客户",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000001",
    wechatId: "wx",
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: "项目",
    notes: null,
    salesStage: "new_lead",
    status: "active",
    ownerId: SEED_IDS.staffA,
    releaserUserId: null,
    isPinned: 0,
    pinnedAt: null,
    lastFollowUpAt: null,
    lastValidFollowUpAt: null,
    nextFollowUpAt: null,
    createdBy: SEED_IDS.staffA,
    updatedBy: SEED_IDS.staffA,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    ...overrides,
  } as Customer;
}

async function clearCollaborators(
  db: ReturnType<typeof drizzle<typeof schema>>,
  customerId: string,
) {
  await db
    .delete(schema.customerAssignees)
    .where(
      eq(schema.customerAssignees.customerId, customerId),
    );
  const now = new Date().toISOString();
  await db.insert(schema.customerAssignees).values({
    id: `ca_${customerId}_${SEED_IDS.staffA}`,
    customerId,
    userId: SEED_IDS.staffA,
    role: "primary",
    assignedBy: SEED_IDS.admin,
    assignedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

describe("canManageCustomerAssignees", () => {
  const activeCustomer = makeCustomer({ id: CUSTOMER_ID });

  it("allows admin on active owned customer", () => {
    assert.equal(canManageCustomerAssignees(admin, activeCustomer), true);
  });

  it("denies owner staff direct management", () => {
    assert.equal(canManageCustomerAssignees(staffA, activeCustomer), false);
  });

  it("denies public pool customer", () => {
    const publicPool = makeCustomer({
      id: CUSTOMER_ID,
      status: "public_pool",
      ownerId: null,
    });
    assert.equal(canManageCustomerAssignees(admin, publicPool), false);
  });

  it("denies archived customer", () => {
    const archived = makeCustomer({
      id: CUSTOMER_ID,
      status: "archived",
    });
    assert.equal(canManageCustomerAssignees(admin, archived), false);
  });
});

describe("applyCollaboratorAssignees", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let dispose: (() => Promise<void>) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;

    await db
      .update(schema.users)
      .set({ isActive: 1, deletedAt: null })
      .where(eq(schema.users.id, SEED_IDS.staffB));

    await clearCollaborators(db, CUSTOMER_ID);
  });

  after(async () => {
    await clearCollaborators(db, CUSTOMER_ID);
    await db
      .update(schema.users)
      .set({ isActive: 1, deletedAt: null })
      .where(eq(schema.users.id, SEED_IDS.staffB));
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("adds collaborator for admin assignedBy", async () => {
    const result = await applyCollaboratorAssignees(db, {
      customerId: CUSTOMER_ID,
      collaboratorUserIds: [SEED_IDS.staffB],
      assignedBy: SEED_IDS.admin,
    });

    assert.deepEqual(
      result.collaborators.map((row) => row.userId),
      [SEED_IDS.staffB],
    );
    assert.ok(result.assignees.some((row) => row.role === "primary"));
  });

  it("removes collaborator", async () => {
    await applyCollaboratorAssignees(db, {
      customerId: CUSTOMER_ID,
      collaboratorUserIds: [SEED_IDS.staffB],
      assignedBy: SEED_IDS.admin,
    });

    const result = await applyCollaboratorAssignees(db, {
      customerId: CUSTOMER_ID,
      collaboratorUserIds: [],
      assignedBy: SEED_IDS.admin,
    });

    assert.equal(result.collaborators.length, 0);
    assert.ok(result.assignees.some((row) => row.role === "primary"));
  });

  it("clears all collaborators", async () => {
    await applyCollaboratorAssignees(db, {
      customerId: CUSTOMER_ID,
      collaboratorUserIds: [SEED_IDS.staffB],
      assignedBy: SEED_IDS.admin,
    });

    await applyCollaboratorAssignees(db, {
      customerId: CUSTOMER_ID,
      collaboratorUserIds: [],
      assignedBy: SEED_IDS.admin,
    });

    const rows = await listCustomerAssignees(db, CUSTOMER_ID);
    assert.equal(rows.filter((row) => row.role === "collaborator").length, 0);
    assert.ok(rows.some((row) => row.role === "primary"));
  });

  it("does not delete primary row", async () => {
    await applyCollaboratorAssignees(db, {
      customerId: CUSTOMER_ID,
      collaboratorUserIds: [SEED_IDS.staffB],
      assignedBy: SEED_IDS.admin,
    });

    const rows = await listCustomerAssignees(db, CUSTOMER_ID);
    const primary = rows.filter((row) => row.role === "primary");
    assert.equal(primary.length, 1);
    assert.equal(primary[0]?.userId, SEED_IDS.staffA);
  });

  it("does not modify customers.ownerId", async () => {
    const before = await db
      .select({ ownerId: schema.customers.ownerId })
      .from(schema.customers)
      .where(eq(schema.customers.id, CUSTOMER_ID))
      .limit(1);

    await applyCollaboratorAssignees(db, {
      customerId: CUSTOMER_ID,
      collaboratorUserIds: [SEED_IDS.staffB],
      assignedBy: SEED_IDS.admin,
    });

    const after = await db
      .select({ ownerId: schema.customers.ownerId })
      .from(schema.customers)
      .where(eq(schema.customers.id, CUSTOMER_ID))
      .limit(1);

    assert.equal(after[0]?.ownerId, before[0]?.ownerId);
    assert.equal(after[0]?.ownerId, SEED_IDS.staffA);
  });

  it("rejects owner as collaborator", async () => {
    await assert.rejects(
      () =>
        applyCollaboratorAssignees(db, {
          customerId: CUSTOMER_ID,
          collaboratorUserIds: [SEED_IDS.staffA],
          assignedBy: SEED_IDS.admin,
        }),
      (error: unknown) =>
        error instanceof AssigneeMutationError &&
        error.code === "COLLABORATOR_INCLUDES_OWNER",
    );
  });

  it("rejects admin as collaborator", async () => {
    await assert.rejects(
      () =>
        applyCollaboratorAssignees(db, {
          customerId: CUSTOMER_ID,
          collaboratorUserIds: [SEED_IDS.admin],
          assignedBy: SEED_IDS.admin,
        }),
      (error: unknown) =>
        error instanceof AssigneeMutationError &&
        error.code === "COLLABORATOR_INCLUDES_ADMIN",
    );
  });

  it("rejects inactive staff", async () => {
    await db
      .update(schema.users)
      .set({ isActive: 0, deletedAt: null })
      .where(eq(schema.users.id, SEED_IDS.staffB));

    try {
      await assert.rejects(
        () =>
          applyCollaboratorAssignees(db, {
            customerId: CUSTOMER_ID,
            collaboratorUserIds: [SEED_IDS.staffB],
            assignedBy: SEED_IDS.admin,
          }),
        (error: unknown) =>
          error instanceof AssigneeMutationError &&
          error.code === "COLLABORATOR_USER_INACTIVE",
      );
    } finally {
      await db
        .update(schema.users)
        .set({ isActive: 1, deletedAt: null })
        .where(eq(schema.users.id, SEED_IDS.staffB));
    }
  });

  it("rejects deleted staff", async () => {
    const deletedAt = new Date().toISOString();
    await db
      .update(schema.users)
      .set({ deletedAt, isActive: 1 })
      .where(eq(schema.users.id, SEED_IDS.staffB));

    try {
      await assert.rejects(
        () =>
          applyCollaboratorAssignees(db, {
            customerId: CUSTOMER_ID,
            collaboratorUserIds: [SEED_IDS.staffB],
            assignedBy: SEED_IDS.admin,
          }),
        (error: unknown) =>
          error instanceof AssigneeMutationError &&
          error.code === "COLLABORATOR_USER_DELETED",
      );
    } finally {
      await db
        .update(schema.users)
        .set({ deletedAt: null, isActive: 1 })
        .where(eq(schema.users.id, SEED_IDS.staffB));
    }
  });

  it("rejects missing user", async () => {
    await assert.rejects(
      () =>
        applyCollaboratorAssignees(db, {
          customerId: CUSTOMER_ID,
          collaboratorUserIds: [MISSING_USER_ID],
          assignedBy: SEED_IDS.admin,
        }),
      (error: unknown) =>
        error instanceof AssigneeMutationError &&
        error.code === "COLLABORATOR_USER_NOT_FOUND",
    );
  });

  it("deduplicates collaborator user ids without duplicate rows", async () => {
    const result = await applyCollaboratorAssignees(db, {
      customerId: CUSTOMER_ID,
      collaboratorUserIds: [SEED_IDS.staffB, SEED_IDS.staffB],
      assignedBy: SEED_IDS.admin,
    });

    assert.equal(result.collaborators.length, 1);
    assert.equal(result.collaborators[0]?.userId, SEED_IDS.staffB);
  });

  it("returns correct listCustomerAssignees after update", async () => {
    await applyCollaboratorAssignees(db, {
      customerId: CUSTOMER_ID,
      collaboratorUserIds: [SEED_IDS.staffB],
      assignedBy: SEED_IDS.admin,
    });

    const rows = await listCustomerAssignees(db, CUSTOMER_ID);
    assert.ok(rows.some((row) => row.role === "primary" && row.userId === SEED_IDS.staffA));
    assert.ok(
      rows.some((row) => row.role === "collaborator" && row.userId === SEED_IDS.staffB),
    );
  });

  it("does not leave partial data when validation fails", async () => {
    await applyCollaboratorAssignees(db, {
      customerId: CUSTOMER_ID,
      collaboratorUserIds: [SEED_IDS.staffB],
      assignedBy: SEED_IDS.admin,
    });

    await assert.rejects(
      () =>
        applyCollaboratorAssignees(db, {
          customerId: CUSTOMER_ID,
          collaboratorUserIds: [MISSING_USER_ID],
          assignedBy: SEED_IDS.admin,
        }),
      (error: unknown) => error instanceof AssigneeMutationError,
    );

    const rows = await listCustomerAssignees(db, CUSTOMER_ID);
    assert.ok(
      rows.some((row) => row.role === "collaborator" && row.userId === SEED_IDS.staffB),
    );
    assert.equal(
      rows.filter((row) => row.role === "collaborator").length,
      1,
    );
  });

  it("rejects missing customer", async () => {
    await assert.rejects(
      () =>
        applyCollaboratorAssignees(db, {
          customerId: "00000000-0000-0000-0000-000000000001",
          collaboratorUserIds: [],
          assignedBy: SEED_IDS.admin,
        }),
      (error: unknown) =>
        error instanceof AssigneeMutationError &&
        error.code === "CUSTOMER_NOT_FOUND",
    );
  });
});

describe("applyCollaboratorAssignees permission boundary", () => {
  it("owner staff cannot manage via permission helper", () => {
    const customer = makeCustomer({ id: CUSTOMER_ID });
    assert.throws(
      () => {
        if (!canManageCustomerAssignees(staffA, customer)) {
          throw new PermissionError(
            403,
            "无权管理该客户的负责员工",
            "permission.denied.customer_assignees_manage",
          );
        }
      },
      PermissionError,
    );
  });
});
