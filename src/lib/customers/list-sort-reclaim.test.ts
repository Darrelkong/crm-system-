import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Customer } from "../../../drizzle/schema/customers";
import {
  compareCustomersForReclaimSoonest,
  getReclaimSortKey,
} from "./list-sort-reclaim";

const RECLAIM_DAYS = 45;
const NOW = new Date("2026-08-06T04:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgoIso(days: number): string {
  return new Date(NOW.getTime() - days * MS_PER_DAY).toISOString();
}

function makeCustomer(
  overrides: Partial<Customer> & Pick<Customer, "id" | "customerName">,
): Customer {
  const anchor = daysAgoIso(10);
  return {
    customerCode: null,
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: null,
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    requestedProjectCode: null,
    notes: null,
    salesStage: "negotiation",
    status: "active",
    ownerId: "11111111-1111-1111-1111-111111111102",
    releaserUserId: null,
    isPinned: 0,
    pinnedAt: null,
    lastFollowUpAt: null,
    lastValidFollowUpAt: anchor,
    nextFollowUpAt: null,
    reclamationCycleStartedAt: anchor,
    reclaimRuleGraceUntil: null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    collaborativeDissolvedAt: null,
    lifecycleStatus: null,
    lifecycleCompletedAt: null,
    lifecycleCompletedBy: null,
    lifecycleCompletionNotes: null,
    preferredName: null,
    gender: null,
    ageRange: null,
    preferredLanguage: null,
    preferredContactMethod: null,
    occupation: null,
    companyName: null,
    jobTitle: null,
    targetCountryOrRegion: null,
    primaryConcern: null,
    createdBy: "11111111-1111-1111-1111-111111111102",
    updatedBy: "11111111-1111-1111-1111-111111111102",
    createdAt: anchor,
    updatedAt: anchor,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    ...overrides,
  } as Customer;
}

describe("reclaim_soonest sort keys", () => {
  it("orders due before grace before countdown before ineligible", () => {
    const due = makeCustomer({
      id: "due",
      customerName: "Due",
      lastValidFollowUpAt: daysAgoIso(45),
      reclamationCycleStartedAt: daysAgoIso(45),
    });
    const grace = makeCustomer({
      id: "grace",
      customerName: "Grace",
      lastValidFollowUpAt: daysAgoIso(50),
      reclamationCycleStartedAt: daysAgoIso(50),
      reclaimRuleGraceUntil: new Date(
        NOW.getTime() + 2 * 60 * 60 * 1000,
      ).toISOString(),
    });
    const oneDay = makeCustomer({
      id: "one",
      customerName: "One",
      lastValidFollowUpAt: daysAgoIso(44),
      reclamationCycleStartedAt: daysAgoIso(44),
    });
    const ineligible = makeCustomer({
      id: "pin",
      customerName: "Pinned",
      isPinned: 1,
      pinnedAt: daysAgoIso(1),
    });

    assert.equal(getReclaimSortKey(due, RECLAIM_DAYS, NOW).group, 0);
    assert.equal(getReclaimSortKey(grace, RECLAIM_DAYS, NOW).group, 1);
    assert.equal(getReclaimSortKey(oneDay, RECLAIM_DAYS, NOW).group, 2);
    assert.equal(getReclaimSortKey(ineligible, RECLAIM_DAYS, NOW).group, 3);

    assert.ok(
      compareCustomersForReclaimSoonest(due, grace, RECLAIM_DAYS, NOW) < 0,
    );
    assert.ok(
      compareCustomersForReclaimSoonest(grace, oneDay, RECLAIM_DAYS, NOW) < 0,
    );
    assert.ok(
      compareCustomersForReclaimSoonest(oneDay, ineligible, RECLAIM_DAYS, NOW) <
        0,
    );
  });

  it("sorts grace by graceUntil ASC", () => {
    const sooner = makeCustomer({
      id: "g-soon",
      customerName: "Soon",
      lastValidFollowUpAt: daysAgoIso(50),
      reclamationCycleStartedAt: daysAgoIso(50),
      reclaimRuleGraceUntil: new Date(
        NOW.getTime() + 2 * 60 * 60 * 1000,
      ).toISOString(),
    });
    const later = makeCustomer({
      id: "g-late",
      customerName: "Later",
      lastValidFollowUpAt: daysAgoIso(50),
      reclamationCycleStartedAt: daysAgoIso(50),
      reclaimRuleGraceUntil: new Date(
        NOW.getTime() + 10 * 60 * 60 * 1000,
      ).toISOString(),
    });

    assert.ok(
      compareCustomersForReclaimSoonest(sooner, later, RECLAIM_DAYS, NOW) < 0,
    );
  });

  it("sorts countdown by days remaining ascending", () => {
    const one = makeCustomer({
      id: "d1",
      customerName: "1d",
      lastValidFollowUpAt: daysAgoIso(44),
      reclamationCycleStartedAt: daysAgoIso(44),
    });
    const two = makeCustomer({
      id: "d2",
      customerName: "2d",
      lastValidFollowUpAt: daysAgoIso(43),
      reclamationCycleStartedAt: daysAgoIso(43),
    });
    const seven = makeCustomer({
      id: "d7",
      customerName: "7d",
      lastValidFollowUpAt: daysAgoIso(38),
      reclamationCycleStartedAt: daysAgoIso(38),
    });
    const thirty = makeCustomer({
      id: "d30",
      customerName: "30d",
      lastValidFollowUpAt: daysAgoIso(15),
      reclamationCycleStartedAt: daysAgoIso(15),
    });
    const thirtyOne = makeCustomer({
      id: "d31",
      customerName: "31d",
      lastValidFollowUpAt: daysAgoIso(14),
      reclamationCycleStartedAt: daysAgoIso(14),
    });

    assert.ok(compareCustomersForReclaimSoonest(one, two, RECLAIM_DAYS, NOW) < 0);
    assert.ok(compareCustomersForReclaimSoonest(two, seven, RECLAIM_DAYS, NOW) < 0);
    assert.ok(
      compareCustomersForReclaimSoonest(seven, thirty, RECLAIM_DAYS, NOW) < 0,
    );
    assert.ok(
      compareCustomersForReclaimSoonest(thirty, thirtyOne, RECLAIM_DAYS, NOW) < 0,
    );
  });

  it("keeps eligible >30d ahead of ineligible customers", () => {
    const far = makeCustomer({
      id: "far",
      customerName: "Far",
      lastValidFollowUpAt: daysAgoIso(5),
      reclamationCycleStartedAt: daysAgoIso(5),
    });
    const pinned = makeCustomer({
      id: "pinned",
      customerName: "Pinned",
      isPinned: 1,
      pinnedAt: daysAgoIso(1),
    });

    assert.ok(
      compareCustomersForReclaimSoonest(far, pinned, RECLAIM_DAYS, NOW) < 0,
    );
  });

  it("marks pinned, collaborator, public pool, and excluded stages ineligible", () => {
    const collaborative = new Map([["collab", true]]);
    assert.equal(
      getReclaimSortKey(
        makeCustomer({ id: "collab", customerName: "Collab" }),
        RECLAIM_DAYS,
        NOW,
        { isCollaborative: true },
      ).group,
      3,
    );
    assert.equal(
      getReclaimSortKey(
        makeCustomer({
          id: "pool",
          customerName: "Pool",
          status: "public_pool",
          ownerId: null,
        }),
        RECLAIM_DAYS,
        NOW,
      ).group,
      3,
    );
    for (const salesStage of ["closed_won", "converted", "paid", "on_hold"]) {
      assert.equal(
        getReclaimSortKey(
          makeCustomer({
            id: salesStage,
            customerName: salesStage,
            salesStage,
          }),
          RECLAIM_DAYS,
          NOW,
        ).group,
        3,
      );
    }
    assert.equal(
      getReclaimSortKey(
        makeCustomer({
          id: "collab",
          customerName: "Collab map",
        }),
        RECLAIM_DAYS,
        NOW,
        { isCollaborative: collaborative.get("collab") },
      ).group,
      3,
    );
  });

  it("uses default list order as tie-break for same remaining days", () => {
    const overdue = makeCustomer({
      id: "overdue",
      customerName: "Overdue",
      lastValidFollowUpAt: daysAgoIso(44),
      reclamationCycleStartedAt: daysAgoIso(44),
      nextFollowUpAt: daysAgoIso(1),
    });
    const plain = makeCustomer({
      id: "plain",
      customerName: "Plain",
      lastValidFollowUpAt: daysAgoIso(44),
      reclamationCycleStartedAt: daysAgoIso(44),
      nextFollowUpAt: null,
    });

    assert.ok(
      compareCustomersForReclaimSoonest(overdue, plain, RECLAIM_DAYS, NOW) < 0,
    );
  });
});

describe("HK calendar idle days alignment", () => {
  it("matches getDaysWithoutValidFollowUp across UTC/HK midnight", () => {
    const anchor = "2026-01-01T10:00:00.000Z";
    const customer = makeCustomer({
      id: "hk",
      customerName: "HK",
      reclamationCycleStartedAt: anchor,
      lastValidFollowUpAt: anchor,
      createdAt: anchor,
    });
    const sameHkDay = new Date("2026-01-01T14:00:00.000Z");
    const nextHkDay = new Date("2026-01-01T16:00:00.000Z");

    assert.equal(getReclaimSortKey(customer, 45, sameHkDay).daysRemaining, 45);
    assert.equal(getReclaimSortKey(customer, 45, nextHkDay).daysRemaining, 44);
  });
});
