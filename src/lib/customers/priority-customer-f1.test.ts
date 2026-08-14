import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { approveApprovalRequest, ApprovalError } from "@/lib/approvals/service";
import { getApprovalById } from "@/lib/approvals/queries";
import { resolveApiError } from "@/i18n/resolve-api-error";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import type { Messages } from "@/i18n/locales/en";
import {
  adminDirectRemovePriority,
  adminDirectSetPriority,
  approvePriorityCustomerRequest,
  createPriorityApprovalRequest,
  PriorityCustomerError,
} from "./priority-customer-approval";

const CUSTOMER_ID = SEED_IDS.customerStaffA;
const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

const PRIORITY_ERROR_CODES = [
  "CUSTOMER_ALREADY_PRIORITY",
  "CUSTOMER_NOT_PRIORITY",
  "CUSTOMER_ON_HOLD_REQUIRES_PRIORITY",
  "PRIORITY_APPROVAL_ALREADY_PENDING",
  "PRIORITY_APPROVAL_STALE",
  "INVALID_PRIORITY_ACTION",
  "PRIORITY_USE_DEDICATED_ENDPOINT",
] as const;

function tFrom(messages: Messages) {
  return (key: string) => {
    const parts = key.split(".");
    let cur: unknown = messages;
    for (const part of parts) {
      if (!cur || typeof cur !== "object") return key;
      cur = (cur as Record<string, unknown>)[part];
    }
    return typeof cur === "string" ? cur : key;
  };
}

async function loadCustomer(db: TestDb, customerId: string) {
  const rows = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1);
  return rows[0] ?? null;
}

async function resetCustomer(
  db: TestDb,
  overrides: Partial<Customer> = {},
) {
  const now = new Date().toISOString();
  await db
    .update(schema.customers)
    .set({
      salesStage: "new_lead",
      status: "active",
      isPinned: 0,
      pinnedAt: null,
      pinnedSource: null,
      deletedAt: null,
      updatedAt: now,
      ...overrides,
    })
    .where(eq(schema.customers.id, CUSTOMER_ID));
}

async function clearPriorityApprovals(db: TestDb) {
  await db.delete(schema.approvals).where(
    and(
      eq(schema.approvals.customerId, CUSTOMER_ID),
      eq(schema.approvals.status, "pending"),
    ),
  );
}

describe("priority customer F1 hardening", () => {
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
    await resetCustomer(db);
    await clearPriorityApprovals(db);
  });

  after(async () => {
    await clearPriorityApprovals(db);
    await resetCustomer(db);
    bindTestDatabase(null);
    dispose?.();
  });

  it("approval SET rollback keeps approval pending and customer unchanged", async () => {
    await resetCustomer(db);
    await clearPriorityApprovals(db);
    const customer = (await loadCustomer(db, CUSTOMER_ID))!;
    const { id } = await createPriorityApprovalRequest(
      db,
      customer,
      staffA,
      "set_priority_customer",
      "需要优先跟进",
    );
    const approval = (await getApprovalById(db, id))!;

    await assert.rejects(
      () =>
        approvePriorityCustomerRequest(db, approval, customer, admin, null, {
          testAppendStatements: ({ db: batchDb }) => [
            batchDb.insert(schema.customers).values({
              id: CUSTOMER_ID,
              customerName: "duplicate",
              source: "referral",
              createdBy: SEED_IDS.staffA,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }),
          ],
        }),
    );

    const approvalAfter = await getApprovalById(db, id);
    assert.equal(approvalAfter?.status, "pending");
    const customerAfter = await loadCustomer(db, CUSTOMER_ID);
    assert.equal(customerAfter?.isPinned, 0);
  });

  it("approval UNSET rollback keeps approval pending and customer unchanged", async () => {
    await resetCustomer(db, {
      isPinned: 1,
      pinnedAt: "2026-08-14T10:00:00.000Z",
      pinnedSource: "admin_direct",
      salesStage: "paid",
    });
    await clearPriorityApprovals(db);
    const customer = (await loadCustomer(db, CUSTOMER_ID))!;
    const { id } = await createPriorityApprovalRequest(
      db,
      customer,
      staffA,
      "unset_priority_customer",
      "不再需要优先",
    );
    const approval = (await getApprovalById(db, id))!;

    await assert.rejects(
      () =>
        approvePriorityCustomerRequest(db, approval, customer, admin, null, {
          testAppendStatements: ({ db: batchDb }) => [
            batchDb.insert(schema.customers).values({
              id: CUSTOMER_ID,
              customerName: "duplicate",
              source: "referral",
              createdBy: SEED_IDS.staffA,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }),
          ],
        }),
    );

    const approvalAfter = await getApprovalById(db, id);
    assert.equal(approvalAfter?.status, "pending");
    const customerAfter = await loadCustomer(db, CUSTOMER_ID);
    assert.equal(customerAfter?.isPinned, 1);
  });

  it("stale approval after customer snapshot changes returns PRIORITY_APPROVAL_STALE", async () => {
    await resetCustomer(db);
    await clearPriorityApprovals(db);
    const customer = (await loadCustomer(db, CUSTOMER_ID))!;
    const { id } = await createPriorityApprovalRequest(
      db,
      customer,
      staffA,
      "set_priority_customer",
      "需要优先",
    );
    const approval = (await getApprovalById(db, id))!;

    await db
      .update(schema.customers)
      .set({
        isPinned: 1,
        pinnedAt: new Date().toISOString(),
        pinnedSource: "admin_direct",
      })
      .where(eq(schema.customers.id, CUSTOMER_ID));

    const refreshed = (await loadCustomer(db, CUSTOMER_ID))!;
    await assert.rejects(
      () => approvePriorityCustomerRequest(db, approval, refreshed, admin),
      (error: unknown) =>
        error instanceof ApprovalError &&
        error.code === "PRIORITY_APPROVAL_STALE",
    );

    const approvalAfter = await getApprovalById(db, id);
    assert.equal(approvalAfter?.status, "pending");
  });

  it("admin SET cannot overwrite on_hold_auto after concurrent enter On Hold", async () => {
    await resetCustomer(db);
    const customer = (await loadCustomer(db, CUSTOMER_ID))!;

    await db
      .update(schema.customers)
      .set({
        salesStage: "on_hold",
        isPinned: 1,
        pinnedAt: "2026-08-14T10:00:00.000Z",
        pinnedSource: "on_hold_auto",
      })
      .where(eq(schema.customers.id, CUSTOMER_ID));

    const result = await adminDirectSetPriority(db, customer, admin);
    assert.equal(result, "no_change");

    const after = await loadCustomer(db, CUSTOMER_ID);
    assert.equal(after?.pinnedSource, "on_hold_auto");
  });

  it("admin REMOVE cannot unpin after concurrent enter On Hold", async () => {
    await resetCustomer(db, {
      isPinned: 1,
      pinnedAt: "2026-08-14T10:00:00.000Z",
      pinnedSource: "admin_direct",
      salesStage: "paid",
    });
    const customer = (await loadCustomer(db, CUSTOMER_ID))!;

    await db
      .update(schema.customers)
      .set({ salesStage: "on_hold" })
      .where(eq(schema.customers.id, CUSTOMER_ID));

    await assert.rejects(
      () => adminDirectRemovePriority(db, customer, admin),
      (error: unknown) =>
        error instanceof PriorityCustomerError &&
        error.errorCode === "CUSTOMER_ON_HOLD_REQUIRES_PRIORITY",
    );

    const after = await loadCustomer(db, CUSTOMER_ID);
    assert.equal(after?.isPinned, 1);
    assert.equal(after?.salesStage, "on_hold");
  });

  it("archived customer pending SET approval cannot execute", async () => {
    await resetCustomer(db);
    await clearPriorityApprovals(db);
    const customer = (await loadCustomer(db, CUSTOMER_ID))!;
    const { id } = await createPriorityApprovalRequest(
      db,
      customer,
      staffA,
      "set_priority_customer",
      "需要优先",
    );

    await db
      .update(schema.customers)
      .set({ status: "archived", deletedAt: new Date().toISOString() })
      .where(eq(schema.customers.id, CUSTOMER_ID));

    const approval = (await getApprovalById(db, id))!;

    await assert.rejects(
      () => approveApprovalRequest(id, admin),
      (error: unknown) =>
        error instanceof ApprovalError &&
        error.code === "PRIORITY_APPROVAL_STALE",
    );

    const approvalAfter = await getApprovalById(db, id);
    assert.equal(approvalAfter?.status, "pending");
    const customerAfter = await loadCustomer(db, CUSTOMER_ID);
    assert.equal(customerAfter?.isPinned, 0);
  });
});

describe("priority customer F1 i18n", () => {
  const tEn = tFrom(en);
  const tHans = tFrom(zhHans as Messages);
  const tHant = tFrom(zhHant as Messages);

  for (const code of PRIORITY_ERROR_CODES) {
    it(`maps ${code} in all locales`, () => {
      const enMsg = resolveApiError(tEn, { errorCode: code, error: "中文回退" });
      const hansMsg = resolveApiError(tHans, { errorCode: code, error: "中文回退" });
      const hantMsg = resolveApiError(tHant, { errorCode: code, error: "中文回退" });
      assert.notEqual(enMsg, "中文回退");
      assert.notEqual(hansMsg, "中文回退");
      assert.notEqual(hantMsg, "中文回退");
    });
  }
});

describe("priority customer F1 UI regression", () => {
  it("does not globally disable submit approval when priority pending", () => {
    const entry = readFileSync(
      join(process.cwd(), "src/components/customers/customer-approval-requests-entry.tsx"),
      "utf8",
    );
    const modal = readFileSync(
      join(process.cwd(), "src/components/customers/customer-approval-requests-modal.tsx"),
      "utf8",
    );
    assert.doesNotMatch(
      entry,
      /disabled=\{[^}]*pendingPriorityApproval/,
    );
    assert.match(modal, /priorityApprovalPending/);
    assert.match(modal, /CUSTOMER_DETAIL_APPROVAL_REQUEST_TYPES/);
  });
});
