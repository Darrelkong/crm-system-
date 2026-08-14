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
import {
  canEditCustomer,
} from "@/lib/permissions/customers";
import { mergePriorityFieldsForStageTransition } from "./priority-customer";
import { buildSalesStageUpdateWithPriority } from "./priority-stage-update";
import {
  approveApprovalRequest,
  createApprovalRequest,
  rejectApprovalRequest,
} from "@/lib/approvals/service";
import { getApprovalById } from "@/lib/approvals/queries";

const CUSTOMER_ID = SEED_IDS.customerStaffA;
const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

async function loadCustomer(db: TestDb, customerId: string) {
  const rows = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1);
  return rows[0] ?? null;
}

import type { PinnedSource } from "./priority-customer";

async function setCustomerOnHoldState(
  db: TestDb,
  overrides: {
    isPinned: number;
    pinnedSource: PinnedSource | null;
    pinnedAt?: string | null;
  },
) {
  const now = new Date().toISOString();
  await db
    .update(schema.customers)
    .set({
      salesStage: "on_hold",
      status: "active",
      deletedAt: null,
      isPinned: overrides.isPinned,
      pinnedSource: overrides.pinnedSource,
      pinnedAt: overrides.pinnedAt ?? (overrides.isPinned ? now : null),
      updatedAt: now,
    })
    .where(eq(schema.customers.id, CUSTOMER_ID));
}

async function applyDirectStageTransition(
  db: TestDb,
  customer: Customer,
  nextStage: string,
  actorId: string,
) {
  const now = new Date().toISOString();
  const priorityTransition = mergePriorityFieldsForStageTransition(
    customer.salesStage,
    nextStage,
    customer,
    now,
  );
  await db
    .update(schema.customers)
    .set({
      salesStage: nextStage,
      updatedBy: actorId,
      updatedAt: now,
      ...(priorityTransition.patch ?? {}),
    })
    .where(eq(schema.customers.id, customer.id));
}

async function clearPaidApprovals(db: TestDb) {
  await db.delete(schema.approvals).where(
    and(
      eq(schema.approvals.customerId, CUSTOMER_ID),
      eq(schema.approvals.requestType, "paid_customer"),
    ),
  );
}

describe("priority on-hold exit guarantee", () => {
  let db: TestDb;
  let dispose: (() => void) | undefined;

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
    await clearPaidApprovals(db);
    await db
      .update(schema.customers)
      .set({
        salesStage: "new_lead",
        isPinned: 0,
        pinnedAt: null,
        pinnedSource: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.customers.id, CUSTOMER_ID));
    bindTestDatabase(null);
    dispose?.();
  });

  it("admin direct edit on_hold_auto → clears Priority atomically", async () => {
    await setCustomerOnHoldState(db, {
      isPinned: 1,
      pinnedSource: "on_hold_auto",
    });
    const customer = (await loadCustomer(db, CUSTOMER_ID))!;
    await applyDirectStageTransition(db, customer, "negotiation", admin.id);
    const after = await loadCustomer(db, CUSTOMER_ID);
    assert.equal(after?.salesStage, "negotiation");
    assert.equal(after?.isPinned, 0);
    assert.equal(after?.pinnedSource, null);
    assert.equal(after?.pinnedAt, null);
  });

  it("authorized staff owner direct edit on_hold_auto → clears Priority", async () => {
    await setCustomerOnHoldState(db, {
      isPinned: 1,
      pinnedSource: "on_hold_auto",
    });
    const customer = (await loadCustomer(db, CUSTOMER_ID))!;
    assert.equal(canEditCustomer(staffA, customer), true);
    await applyDirectStageTransition(db, customer, "paid", staffA.id);
    const after = await loadCustomer(db, CUSTOMER_ID);
    assert.equal(after?.salesStage, "paid");
    assert.equal(after?.isPinned, 0);
  });

  it("unauthorized staff cannot edit customer as a new mutation path", async () => {
    await setCustomerOnHoldState(db, {
      isPinned: 1,
      pinnedSource: "on_hold_auto",
    });
    const customer = (await loadCustomer(db, CUSTOMER_ID))!;
    const unrelatedStaff = {
      id: "11111111-1111-1111-1111-111111111199",
      role: "staff",
    } as User;
    assert.equal(canEditCustomer(unrelatedStaff, customer), false);
  });

  for (const [label, pinnedSource] of [
    ["admin_direct", "admin_direct"],
    ["approval", "approval"],
    ["legacy", "legacy"],
    ["NULL source", null],
  ] as const) {
    it(`on_hold + ${label} → leave On Hold remains Priority`, async () => {
      await setCustomerOnHoldState(db, {
        isPinned: 1,
        pinnedSource,
      });
      const customer = (await loadCustomer(db, CUSTOMER_ID))!;
      await applyDirectStageTransition(db, customer, "negotiation", admin.id);
      const after = await loadCustomer(db, CUSTOMER_ID);
      assert.equal(after?.salesStage, "negotiation");
      assert.equal(after?.isPinned, 1);
      if (pinnedSource === null) {
        assert.equal(after?.pinnedSource, null);
      } else {
        assert.equal(after?.pinnedSource, pinnedSource);
      }
    });
  }

  it("approved paid_customer from on_hold_auto clears Priority in one mutation", async () => {
    await clearPaidApprovals(db);
    await setCustomerOnHoldState(db, {
      isPinned: 1,
      pinnedSource: "on_hold_auto",
    });
    const customer = (await loadCustomer(db, CUSTOMER_ID))!;
    const { id } = await createApprovalRequest(customer, staffA, {
      requestType: "paid_customer",
      reason: "客户已付款需要更新阶段",
      payload: {
        serviceItems: "顾问服务",
        paidAmount: "5000",
        paidAt: "2026-07-01",
      },
    });
    const pending = await getApprovalById(db, id);
    assert.equal(pending?.status, "pending");
    assert.equal(customer.isPinned, 1);

    await approveApprovalRequest(id, admin);

    const after = await loadCustomer(db, CUSTOMER_ID);
    assert.equal(after?.salesStage, "paid");
    assert.equal(after?.isPinned, 0);
    assert.equal(after?.pinnedSource, null);
  });

  it("rejected paid_customer keeps On Hold and Priority", async () => {
    await clearPaidApprovals(db);
    await setCustomerOnHoldState(db, {
      isPinned: 1,
      pinnedSource: "on_hold_auto",
      pinnedAt: "2026-08-14T10:00:00.000Z",
    });
    const before = (await loadCustomer(db, CUSTOMER_ID))!;
    const customer = before;
    const { id } = await createApprovalRequest(customer, staffA, {
      requestType: "paid_customer",
      reason: "客户已付款需要更新阶段",
      payload: {
        serviceItems: "顾问服务",
        paidAmount: "5000",
        paidAt: "2026-07-01",
      },
    });

    await rejectApprovalRequest(id, admin, "资料不足");

    const after = await loadCustomer(db, CUSTOMER_ID);
    assert.equal(after?.salesStage, "on_hold");
    assert.equal(after?.isPinned, 1);
    assert.equal(after?.pinnedSource, "on_hold_auto");
    assert.equal(after?.pinnedAt, before.pinnedAt);
  });

  it("on_hold → on_hold does not rewrite Priority timestamp/source", async () => {
    const pinnedAt = "2026-08-14T10:00:00.000Z";
    await setCustomerOnHoldState(db, {
      isPinned: 1,
      pinnedSource: "on_hold_auto",
      pinnedAt,
    });
    const customer = (await loadCustomer(db, CUSTOMER_ID))!;
    const update = buildSalesStageUpdateWithPriority(
      customer,
      "on_hold",
      admin.id,
      new Date().toISOString(),
    );
    assert.equal(update.priorityAudit, null);
    assert.deepEqual(update.update, {
      salesStage: "on_hold",
      updatedBy: admin.id,
      updatedAt: update.update.updatedAt,
    });
  });
});
