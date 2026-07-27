import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  CUSTOMER_NAME_CONFIRMED_AUDIT_ACTION,
  ConfirmNameError,
  normalizeConfirmCustomerName,
  assertCanConfirmPendingCustomerName,
} from "@/lib/customers/confirm-name";
import {
  createConfirmCustomerNameSubmitFlight,
  postConfirmCustomerNameOnce,
} from "@/lib/customers/confirm-name-submit-flight";
import {
  AUDIT_ACTION_LABELS,
  CUSTOMER_TIMELINE_AUDIT_ACTIONS,
} from "@/lib/customers/timeline/constants";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";

const modalSource = readFileSync(
  join(
    process.cwd(),
    "src/components/customers/confirm-customer-name-modal.tsx",
  ),
  "utf8",
);
const routeSource = readFileSync(
  join(
    process.cwd(),
    "src/app/api/customers/[id]/confirm-name/route.ts",
  ),
  "utf8",
);
const detailSource = readFileSync(
  join(
    process.cwd(),
    "src/app/(dashboard)/customers/[id]/customer-detail-client.tsx",
  ),
  "utf8",
);
const confirmServiceSource = readFileSync(
  join(process.cwd(), "src/lib/customers/confirm-name.ts"),
  "utf8",
);

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: SEED_IDS.staffA,
    role: "staff",
    isActive: 1,
    deletedAt: null,
    email: "staff-a@crm.local",
    displayName: "Staff A",
    ...overrides,
  } as User;
}

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  const now = "2026-07-27T12:00:00.000Z";
  return {
    id: "33333333-3333-3333-3333-333333333401",
    customerCode: "EF-CN-401",
    customerName: "X先生",
    nameStatus: "pending",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000401",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    notes: null,
    salesStage: "new_lead",
    status: "active",
    ownerId: SEED_IDS.staffA,
    releaserUserId: null,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    createdBy: SEED_IDS.staffA,
    updatedBy: SEED_IDS.staffA,
    lastFollowUpAt: null,
    lastValidFollowUpAt: null,
    nextFollowUpAt: null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: 0,
    pinnedAt: null,
    collaborativeDissolvedAt: null,
    lifecycleStatus: null,
    lifecycleCompletedAt: null,
    lifecycleCompletedBy: null,
    lifecycleCompletionNotes: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Customer;
}

function mockDb(assignees: Array<{ userId: string; role: string }> = []) {
  return {
    select() {
      return {
        from() {
          return {
            where() {
              return Promise.resolve(
                assignees.map((row, index) => ({
                  id: `a-${index}`,
                  customerId: "c1",
                  userId: row.userId,
                  role: row.role,
                  assignedBy: null,
                  assignedAt: "2026-07-27T12:00:00.000Z",
                  createdAt: "2026-07-27T12:00:00.000Z",
                  updatedAt: "2026-07-27T12:00:00.000Z",
                })),
              );
            },
          };
        },
      };
    },
  } as never;
}

describe("normalizeConfirmCustomerName", () => {
  it("accepts normal Chinese and English names", () => {
    assert.equal(normalizeConfirmCustomerName("王小明").ok, true);
    assert.equal(normalizeConfirmCustomerName("John Smith").ok, true);
  });

  it("rejects blank, short, and placeholder names", () => {
    assert.equal(normalizeConfirmCustomerName("").ok, false);
    assert.equal(normalizeConfirmCustomerName("   ").ok, false);
    assert.equal(normalizeConfirmCustomerName("王").ok, false);
    assert.equal(normalizeConfirmCustomerName("X先生").ok, false);
    assert.equal(normalizeConfirmCustomerName("X女士").ok, false);
    assert.equal(normalizeConfirmCustomerName("Mr. X").ok, false);
    assert.equal(normalizeConfirmCustomerName("Ms. X").ok, false);
    assert.equal(normalizeConfirmCustomerName("mr. x").ok, false);
  });
});

describe("assertCanConfirmPendingCustomerName", () => {
  it("allows admin and owner", async () => {
    const customer = makeCustomer();
    await assertCanConfirmPendingCustomerName(
      mockDb(),
      makeUser({ id: SEED_IDS.admin, role: "admin" }),
      customer,
    );
    await assertCanConfirmPendingCustomerName(
      mockDb(),
      makeUser({ id: SEED_IDS.staffA }),
      customer,
    );
  });

  it("allows active non-collaborator assignee", async () => {
    await assertCanConfirmPendingCustomerName(
      mockDb([{ userId: SEED_IDS.staffB, role: "primary" }]),
      makeUser({ id: SEED_IDS.staffB }),
      makeCustomer({ ownerId: SEED_IDS.staffA }),
    );
  });

  it("rejects collaborator, non-assignee, disabled, deleted, pool, confirmed", async () => {
    await assert.rejects(
      () =>
        assertCanConfirmPendingCustomerName(
          mockDb([{ userId: SEED_IDS.staffB, role: "collaborator" }]),
          makeUser({ id: SEED_IDS.staffB }),
          makeCustomer({ ownerId: SEED_IDS.staffA }),
        ),
      (error: unknown) =>
        error instanceof ConfirmNameError && error.status === 403,
    );

    await assert.rejects(
      () =>
        assertCanConfirmPendingCustomerName(
          mockDb(),
          makeUser({ id: SEED_IDS.staffB }),
          makeCustomer({ ownerId: SEED_IDS.staffA }),
        ),
      (error: unknown) =>
        error instanceof ConfirmNameError && error.status === 403,
    );

    await assert.rejects(
      () =>
        assertCanConfirmPendingCustomerName(
          mockDb(),
          makeUser({ id: SEED_IDS.staffA, isActive: 0 }),
          makeCustomer(),
        ),
      (error: unknown) =>
        error instanceof ConfirmNameError && error.code === "ACTOR_DISABLED",
    );

    await assert.rejects(
      () =>
        assertCanConfirmPendingCustomerName(
          mockDb(),
          makeUser({
            id: SEED_IDS.staffA,
            deletedAt: "2026-07-01T00:00:00.000Z",
          }),
          makeCustomer(),
        ),
      (error: unknown) =>
        error instanceof ConfirmNameError && error.code === "ACTOR_DELETED",
    );

    await assert.rejects(
      () =>
        assertCanConfirmPendingCustomerName(
          mockDb(),
          makeUser({ id: SEED_IDS.admin, role: "admin" }),
          makeCustomer({ status: "public_pool", ownerId: null }),
        ),
      (error: unknown) =>
        error instanceof ConfirmNameError &&
        error.code === "CUSTOMER_IN_PUBLIC_POOL",
    );

    await assert.rejects(
      () =>
        assertCanConfirmPendingCustomerName(
          mockDb(),
          makeUser({ id: SEED_IDS.admin, role: "admin" }),
          makeCustomer({ nameStatus: "confirmed", customerName: "王小明" }),
        ),
      (error: unknown) =>
        error instanceof ConfirmNameError && error.status === 409,
    );
  });
});

describe("confirm-name conditional update + audit wiring", () => {
  it("uses pending-only WHERE and writes audit only after update", () => {
    assert.match(
      confirmServiceSource,
      /eq\(schema\.customers\.nameStatus,\s*"pending"\)/,
    );
    assert.match(
      confirmServiceSource,
      /CUSTOMER_NAME_CONFIRMED_AUDIT_ACTION|customer\.name\.confirmed/,
    );
    assert.match(confirmServiceSource, /writeFieldChangeLogEntry/);
    assert.match(confirmServiceSource, /writeAuditLog/);
    assert.match(confirmServiceSource, /changes === 0/);
    assert.equal(
      CUSTOMER_TIMELINE_AUDIT_ACTIONS.has(CUSTOMER_NAME_CONFIRMED_AUDIT_ACTION),
      true,
    );
    assert.ok(AUDIT_ACTION_LABELS[CUSTOMER_NAME_CONFIRMED_AUDIT_ACTION]);
  });

  it("route only accepts customerName from body", () => {
    assert.match(routeSource, /body\.customerName/);
    assert.doesNotMatch(routeSource, /body\.nameStatus/);
    assert.match(routeSource, /requireAuth/);
  });
});

describe("confirm-name submit single-flight", () => {
  it("same-tick 2 and 4 calls only POST once", async () => {
    let posts = 0;
    const fetchImpl: typeof fetch = async () => {
      posts += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const flight2 = createConfirmCustomerNameSubmitFlight();
    const dual = await Promise.all([
      postConfirmCustomerNameOnce({
        flight: flight2,
        customerId: "c1",
        body: { customerName: "王小明" },
        fetchImpl,
      }),
      postConfirmCustomerNameOnce({
        flight: flight2,
        customerId: "c1",
        body: { customerName: "王小明" },
        fetchImpl,
      }),
    ]);
    assert.equal(posts, 1);
    assert.equal(dual.filter((r) => r.status === "blocked").length, 1);

    posts = 0;
    const flight4 = createConfirmCustomerNameSubmitFlight();
    const quad = await Promise.all(
      Array.from({ length: 4 }, () =>
        postConfirmCustomerNameOnce({
          flight: flight4,
          customerId: "c1",
          body: { customerName: "王小明" },
          fetchImpl,
        }),
      ),
    );
    assert.equal(posts, 1);
    assert.equal(quad.filter((r) => r.status === "blocked").length, 3);
  });

  it("keeps lock after success and releases on network error", async () => {
    const flight = createConfirmCustomerNameSubmitFlight();
    const ok = await postConfirmCustomerNameOnce({
      flight,
      customerId: "c1",
      body: { customerName: "王小明" },
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    });
    assert.equal(ok.status, "response");
    assert.equal(flight.isLocked(), true);
    assert.equal(
      (
        await postConfirmCustomerNameOnce({
          flight,
          customerId: "c1",
          body: { customerName: "王小明" },
          fetchImpl: async () =>
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
        })
      ).status,
      "blocked",
    );

    const flight2 = createConfirmCustomerNameSubmitFlight();
    const net = await postConfirmCustomerNameOnce({
      flight: flight2,
      customerId: "c1",
      body: { customerName: "王小明" },
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    assert.equal(net.status, "network_error");
    assert.equal(flight2.isLocked(), false);
  });

  it("HTTP 500 leaves lock held until caller releases for retry", async () => {
    const flight = createConfirmCustomerNameSubmitFlight();
    let posts = 0;
    const first = await postConfirmCustomerNameOnce({
      flight,
      customerId: "c1",
      body: { customerName: "王小明" },
      fetchImpl: async () => {
        posts += 1;
        return new Response(JSON.stringify({ error: "x" }), { status: 500 });
      },
    });
    assert.equal(first.status, "response");
    assert.equal(flight.isLocked(), true);
    flight.release();
    const second = await postConfirmCustomerNameOnce({
      flight,
      customerId: "c1",
      body: { customerName: "王小明" },
      fetchImpl: async () => {
        posts += 1;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    assert.equal(second.status, "response");
    assert.equal(posts, 2);
  });
});

describe("confirm-name UI wiring", () => {
  it("shows modal button only via showConfirmNameButton and blank input", () => {
    assert.match(detailSource, /showConfirmNameButton/);
    assert.match(detailSource, /ConfirmCustomerNameModal/);
    assert.match(modalSource, /createConfirmCustomerNameSubmitFlight/);
    assert.match(modalSource, /postConfirmCustomerNameOnce/);
    assert.match(modalSource, /useState\(""\)/);
    assert.match(modalSource, /confirmNameConflict/);
    assert.match(modalSource, /Enter/);
  });
});

describe("confirm-name i18n parity", () => {
  it("keeps confirm-name keys across locales", () => {
    for (const locale of [zhHant, zhHans, en]) {
      assert.ok(locale.customers.confirmRealName);
      assert.ok(locale.customers.confirmNamePlaceholder);
      assert.ok(locale.customers.confirmNameConflict);
      assert.ok(locale.customers.confirmNameSuccess);
      assert.ok(locale.timelineMessages.customerNameConfirmed);
      assert.ok(
        locale.customers.basicAnalysis.findings.customerNamePending.title,
      );
    }
    assert.equal(zhHant.customers.confirmRealName, "確認真實姓名");
    assert.equal(zhHans.customers.confirmRealName, "确认真实姓名");
    assert.equal(en.customers.confirmRealName, "Confirm real name");
    assert.equal(
      zhHant.timelineMessages.customerNameConfirmed,
      "客戶姓名已由待確認更新為真實姓名",
    );
    assert.equal(
      zhHans.timelineMessages.customerNameConfirmed,
      "客户姓名已由待确认更新为真实姓名",
    );
    assert.equal(
      en.timelineMessages.customerNameConfirmed,
      "Customer name confirmed",
    );
  });
});
