import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Customer } from "../../../drizzle/schema/customers";
import {
  compareCustomersForList,
  getFollowUpSortBucket,
} from "./list-sort";

function makeCustomer(
  overrides: Partial<Customer> & Pick<Customer, "id" | "customerName">,
): Customer {
  const now = "2026-06-28T12:00:00.000Z";
  return {
    customerCode: null,
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: null,
    wechatId: "wx",
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: "測試項目名稱四個字",
    notes: "備註備註備註備註備註",
    salesStage: "new_lead",
    status: "active",
    ownerId: "11111111-1111-1111-1111-111111111102",
    releaserUserId: null,
    isPinned: 0,
    pinnedAt: null,
    lastFollowUpAt: null,
    lastValidFollowUpAt: null,
    nextFollowUpAt: null,
    createdBy: "11111111-1111-1111-1111-111111111102",
    updatedBy: "11111111-1111-1111-1111-111111111102",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    ...overrides,
  } as Customer;
}

describe("customer list pin sort", () => {
  const now = new Date("2026-06-28T12:00:00.000Z");

  it("sorts isPinned=1 before unpinned customers", () => {
    const pinned = makeCustomer({
      id: "p1",
      customerName: "Pinned",
      isPinned: 1,
      pinnedAt: "2026-06-28T10:00:00.000Z",
    });
    const normal = makeCustomer({
      id: "n1",
      customerName: "Normal",
      nextFollowUpAt: "2026-06-27T10:00:00.000Z",
    });

    assert.ok(compareCustomersForList(pinned, normal, now) < 0);
  });

  it("sorts pinned customers by pinnedAt DESC", () => {
    const older = makeCustomer({
      id: "p-old",
      customerName: "Older pin",
      isPinned: 1,
      pinnedAt: "2026-06-27T10:00:00.000Z",
    });
    const newer = makeCustomer({
      id: "p-new",
      customerName: "Newer pin",
      isPinned: 1,
      pinnedAt: "2026-06-28T10:00:00.000Z",
    });

    assert.ok(compareCustomersForList(newer, older, now) < 0);
  });

  it("applies follow-up buckets after pin sort for unpinned customers", () => {
    const overdue = makeCustomer({
      id: "o1",
      customerName: "Overdue",
      nextFollowUpAt: "2026-06-27T10:00:00.000Z",
    });
    const normal = makeCustomer({
      id: "n1",
      customerName: "Normal",
      lastValidFollowUpAt: "2026-06-28T08:00:00.000Z",
    });

    assert.ok(compareCustomersForList(overdue, normal, now) < 0);
  });

  it("deprioritizes unpinned on_hold but not pinned on_hold", () => {
    const unpinnedOnHold = makeCustomer({
      id: "oh1",
      customerName: "On hold",
      salesStage: "on_hold",
    });
    const pinnedOnHold = makeCustomer({
      id: "poh1",
      customerName: "Pinned on hold",
      salesStage: "on_hold",
      isPinned: 1,
      pinnedAt: "2026-06-28T09:00:00.000Z",
    });
    const normal = makeCustomer({
      id: "n1",
      customerName: "Normal",
      lastValidFollowUpAt: "2026-06-28T08:00:00.000Z",
    });

    assert.equal(getFollowUpSortBucket(unpinnedOnHold, now), 6);
    assert.notEqual(getFollowUpSortBucket(pinnedOnHold, now), 6);
    assert.ok(compareCustomersForList(pinnedOnHold, unpinnedOnHold, now) < 0);
    assert.ok(compareCustomersForList(normal, unpinnedOnHold, now) < 0);
  });

  it("sorts full list with pinned first then follow-up priority", () => {
    const customers = [
      makeCustomer({
        id: "oh",
        customerName: "On hold unpinned",
        salesStage: "on_hold",
      }),
      makeCustomer({
        id: "overdue",
        customerName: "Overdue",
        nextFollowUpAt: "2026-06-27T10:00:00.000Z",
      }),
      makeCustomer({
        id: "pin-old",
        customerName: "Pinned old",
        isPinned: 1,
        pinnedAt: "2026-06-27T08:00:00.000Z",
        salesStage: "on_hold",
      }),
      makeCustomer({
        id: "pin-new",
        customerName: "Pinned new",
        isPinned: 1,
        pinnedAt: "2026-06-28T09:00:00.000Z",
      }),
    ];

    const sorted = [...customers].sort((a, b) =>
      compareCustomersForList(a, b, now),
    );

    assert.deepEqual(
      sorted.map((c) => c.id),
      ["pin-new", "pin-old", "overdue", "oh"],
    );
  });
});
