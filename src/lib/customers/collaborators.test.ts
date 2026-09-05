import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { getCustomerById } from "@/lib/customers/queries";
import {
  addCustomerCollaborator,
  removeCustomerCollaborator,
} from "./collaborators";
import {
  normalizeCollaboratorEmail,
  verifyCustomerCollaboratorEmail,
} from "./collaborator-verification";
import { listCustomerAssignees } from "./assignees";
import { PermissionError } from "@/lib/permissions/customers";
import { getCustomerTimeline } from "@/lib/customers/timeline/service";

const CUSTOMER_ID = SEED_IDS.customerStaffA;
const COLLABORATOR_ID = SEED_IDS.staffB;
const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const owner = { id: SEED_IDS.staffA, role: "staff" } as User;
const collaborator = { id: COLLABORATOR_ID, role: "staff" } as User;

type Db = ReturnType<typeof drizzle<typeof schema>>;

async function resetCustomer(db: Db): Promise<void> {
  await db
    .delete(schema.customerAssignees)
    .where(eq(schema.customerAssignees.customerId, CUSTOMER_ID));
  const now = new Date().toISOString();
  await db.insert(schema.customerAssignees).values({
    id: `collaboration-test-primary-${CUSTOMER_ID}`,
    customerId: CUSTOMER_ID,
    userId: SEED_IDS.staffA,
    role: "primary",
    assignedBy: SEED_IDS.admin,
    assignedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await db
    .delete(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.entityType, "customer"),
        eq(schema.auditLogs.entityId, CUSTOMER_ID),
        inArray(schema.auditLogs.action, [
          "customer.collaborator_added",
          "customer.collaborator_removed",
        ]),
      ),
    );
  await db
    .delete(schema.notifications)
    .where(eq(schema.notifications.relatedEntityType, "customer_collaborator"));
}

describe("direct customer collaborator management", () => {
  let db: Db;
  let dispose: (() => Promise<void>) | undefined;
  let customer: Customer;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    customer = (await getCustomerById(CUSTOMER_ID))!;
    await db
      .update(schema.users)
      .set({ isActive: 1, deletedAt: null })
      .where(eq(schema.users.id, COLLABORATOR_ID));
    await resetCustomer(db);
  });

  after(async () => {
    await resetCustomer(db);
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("lets the primary owner add/remove without changing ownership", async () => {
    const before = await db
      .select({
        ownerId: schema.customers.ownerId,
        previousOwnerId: schema.customers.previousOwnerId,
      })
      .from(schema.customers)
      .where(eq(schema.customers.id, CUSTOMER_ID))
      .limit(1);
    const beforeApprovals = await db
      .select({ id: schema.approvals.id })
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.customerId, CUSTOMER_ID),
          eq(schema.approvals.requestType, "update_customer_assignees"),
        ),
      );
    const beforeTasks = await db
      .select({
        id: schema.tasks.id,
        assignedTo: schema.tasks.assignedTo,
      })
      .from(schema.tasks)
      .where(eq(schema.tasks.customerId, CUSTOMER_ID));

    const added = await addCustomerCollaborator(db, {
      actor: owner,
      customer,
      collaboratorUserId: COLLABORATOR_ID,
    });
    assert.deepEqual(
      added.collaborators.map((row) => row.userId),
      [COLLABORATOR_ID],
    );

    const afterAdd = await db
      .select()
      .from(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, CUSTOMER_ID));
    assert.ok(
      afterAdd.some(
        (row) => row.role === "primary" && row.userId === SEED_IDS.staffA,
      ),
    );
    assert.equal(
      (await db
        .select({
          ownerId: schema.customers.ownerId,
          previousOwnerId: schema.customers.previousOwnerId,
        })
        .from(schema.customers)
        .where(eq(schema.customers.id, CUSTOMER_ID))
        .limit(1))[0]?.ownerId,
      before[0]?.ownerId,
    );
    const afterAddCustomer = (await db
      .select({
        ownerId: schema.customers.ownerId,
        previousOwnerId: schema.customers.previousOwnerId,
      })
      .from(schema.customers)
      .where(eq(schema.customers.id, CUSTOMER_ID))
      .limit(1))[0];
    assert.equal(afterAddCustomer?.previousOwnerId, before[0]?.previousOwnerId);
    assert.deepEqual(
      await db
        .select({ id: schema.approvals.id })
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.customerId, CUSTOMER_ID),
            eq(schema.approvals.requestType, "update_customer_assignees"),
          ),
        ),
      beforeApprovals,
    );
    assert.deepEqual(
      await db
        .select({
          id: schema.tasks.id,
          assignedTo: schema.tasks.assignedTo,
        })
        .from(schema.tasks)
        .where(eq(schema.tasks.customerId, CUSTOMER_ID)),
      beforeTasks,
    );

    const addAudits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, CUSTOMER_ID),
          eq(schema.auditLogs.action, "customer.collaborator_added"),
        ),
      );
    assert.equal(addAudits.length, 1);
    assert.equal(
      JSON.parse(addAudits[0]!.metadata ?? "{}").collaboratorUserId,
      COLLABORATOR_ID,
    );
    const timeline = await getCustomerTimeline(db, owner, customer);
    assert.ok(
      timeline.items.some(
        (item) =>
          item.type === "audit" &&
          item.titleKey === "timelineMessages.customerCollaboratorAdded",
      ),
    );

    const removed = await removeCustomerCollaborator(db, {
      actor: owner,
      customer,
      collaboratorUserId: COLLABORATOR_ID,
    });
    assert.equal(removed.collaborators.length, 0);

    const finalAssignees = await listCustomerAssignees(db, CUSTOMER_ID);
    assert.deepEqual(
      finalAssignees.filter((row) => row.role === "primary").map((row) => row.userId),
      [SEED_IDS.staffA],
    );
    assert.equal(
      (await db
        .select({ ownerId: schema.customers.ownerId })
        .from(schema.customers)
        .where(eq(schema.customers.id, CUSTOMER_ID))
        .limit(1))[0]?.ownerId,
      before[0]?.ownerId,
    );

    const notifications = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, COLLABORATOR_ID),
          eq(schema.notifications.relatedEntityType, "customer_collaborator"),
        ),
      );
    assert.equal(notifications.length, 2);
    assert.ok(
      notifications.some((row) => row.type === "customer.collaborator_added"),
    );
    assert.ok(
      notifications.some((row) => row.type === "customer.collaborator_removed"),
    );
  });

  it("lets an admin add/remove and rejects duplicate or self membership", async () => {
    await addCustomerCollaborator(db, {
      actor: admin,
      customer,
      collaboratorUserId: COLLABORATOR_ID,
    });

    await assert.rejects(
      () =>
        addCustomerCollaborator(db, {
          actor: admin,
          customer,
          collaboratorUserId: COLLABORATOR_ID,
        }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "COLLABORATOR_ALREADY_EXISTS",
    );

    await assert.rejects(
      () =>
        addCustomerCollaborator(db, {
          actor: owner,
          customer,
          collaboratorUserId: SEED_IDS.staffA,
        }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "COLLABORATOR_SELF",
    );

    await removeCustomerCollaborator(db, {
      actor: admin,
      customer,
      collaboratorUserId: COLLABORATOR_ID,
    });
  });

  it("does not let a collaborator manage other collaborators", async () => {
    await assert.rejects(
      () =>
        addCustomerCollaborator(db, {
          actor: collaborator,
          customer,
          collaboratorUserId: SEED_IDS.admin,
        }),
      (error: unknown) =>
        error instanceof PermissionError &&
        error.auditAction ===
          "permission.denied.customer_collaborators_manage",
    );
  });
});

describe("exact collaborator email verification", () => {
  let db: Db;
  let dispose: (() => Promise<void>) | undefined;
  let customer: Customer;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    customer = (await getCustomerById(CUSTOMER_ID))!;
    await db
      .update(schema.users)
      .set({ isActive: 1, deletedAt: null })
      .where(eq(schema.users.id, COLLABORATOR_ID));
    await resetCustomer(db);
  });

  after(async () => {
    await resetCustomer(db);
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("normalizes exact email and never returns partial candidates", async () => {
    const row = await db
      .select({
        email: schema.users.email,
        displayName: schema.users.displayName,
      })
      .from(schema.users)
      .where(eq(schema.users.id, COLLABORATOR_ID))
      .limit(1);
    const email = row[0]!.email;

    assert.equal(normalizeCollaboratorEmail(`  ${email.toUpperCase()} `), email.toLowerCase());
    const verified = await verifyCustomerCollaboratorEmail(db, {
      actor: owner,
      customer,
      email: `  ${email.toUpperCase()} `,
    });
    assert.deepEqual(verified, {
      id: COLLABORATOR_ID,
      displayName: row[0]!.displayName,
      email: email.toLowerCase(),
    });

    for (const input of ["alice", "ali", "@echfronthk.com", "alice@"]) {
      assert.equal(
        await verifyCustomerCollaboratorEmail(db, {
          actor: owner,
          customer,
          email: input,
        }),
        null,
      );
    }

    assert.equal(
      await verifyCustomerCollaboratorEmail(db, {
        actor: owner,
        customer,
        email: (await db
          .select({ email: schema.users.email })
          .from(schema.users)
          .where(eq(schema.users.id, SEED_IDS.admin))
          .limit(1))[0]!.email,
      }),
      null,
    );

    await addCustomerCollaborator(db, {
      actor: owner,
      customer,
      collaboratorUserId: COLLABORATOR_ID,
    });
    assert.equal(
      await verifyCustomerCollaboratorEmail(db, {
        actor: owner,
        customer,
        email,
      }),
      null,
    );
  });
});
