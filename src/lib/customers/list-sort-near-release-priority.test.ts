import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Customer } from "../../../drizzle/schema/customers";
import { buildCustomerListOrderBy, compareCustomersForList } from "@/lib/customers/list-sort";
import { NEAR_RELEASE_RISK_DAYS } from "@/lib/customers/list-sort-reclaim";
import { getNearReleaseRiskSortKey } from "@/lib/customers/list-sort-reclaim.test-helper";

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

function sortWithRisk(customers: Customer[], collaborativeFlags?: Map<string, boolean>) {
  return [...customers].sort((a, b) =>
    compareCustomersForList(a, b, NOW, {
      automaticReclaimDays: RECLAIM_DAYS,
      collaborativeFlags,
    }),
  );
}

function sortDefaultOnly(customers: Customer[]) {
  return [...customers].sort((a, b) => compareCustomersForList(a, b, NOW));
}

describe("near-release hidden priority (<=16 days)", () => {
  it("exposes the 16-day risk window constant", () => {
    assert.equal(NEAR_RELEASE_RISK_DAYS, 16);
  });

  it("adds risk ORDER BY clauses only when automaticReclaimDays is provided", () => {
    assert.equal(buildCustomerListOrderBy(NOW).length, 6);
    assert.equal(buildCustomerListOrderBy(NOW, RECLAIM_DAYS).length, 9);
  });

  it("prioritizes 16-day over 17-day customers", () => {
    const sixteen = makeCustomer({
      id: "d16",
      customerName: "16d",
      lastValidFollowUpAt: daysAgoIso(RECLAIM_DAYS - 16),
      reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS - 16),
    });
    const seventeen = makeCustomer({
      id: "d17",
      customerName: "17d",
      lastValidFollowUpAt: daysAgoIso(RECLAIM_DAYS - 17),
      reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS - 17),
    });

    assert.equal(
      getNearReleaseRiskSortKey(sixteen, RECLAIM_DAYS, NOW).riskBucket,
      0,
    );
    assert.equal(
      getNearReleaseRiskSortKey(seventeen, RECLAIM_DAYS, NOW).riskBucket,
      1,
    );
    assert.ok(
      compareCustomersForList(sixteen, seventeen, NOW, {
        automaticReclaimDays: RECLAIM_DAYS,
      }) < 0,
    );
  });

  it("orders due → grace → countdown ascending within risk window", () => {
    const due = makeCustomer({
      id: "due",
      customerName: "Due",
      lastValidFollowUpAt: daysAgoIso(RECLAIM_DAYS),
      reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS),
    });
    const grace = makeCustomer({
      id: "grace",
      customerName: "Grace",
      lastValidFollowUpAt: daysAgoIso(RECLAIM_DAYS + 2),
      reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS + 2),
      reclaimRuleGraceUntil: new Date(
        NOW.getTime() + 2 * 60 * 60 * 1000,
      ).toISOString(),
    });
    const oneDay = makeCustomer({
      id: "d1",
      customerName: "1d",
      lastValidFollowUpAt: daysAgoIso(RECLAIM_DAYS - 1),
      reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS - 1),
    });
    const sixteen = makeCustomer({
      id: "d16",
      customerName: "16d",
      lastValidFollowUpAt: daysAgoIso(RECLAIM_DAYS - 16),
      reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS - 16),
    });
    const seventeen = makeCustomer({
      id: "d17",
      customerName: "17d",
      lastValidFollowUpAt: daysAgoIso(RECLAIM_DAYS - 17),
      reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS - 17),
    });

    const sorted = sortWithRisk([seventeen, sixteen, oneDay, grace, due]);
    assert.deepEqual(
      sorted.map((c) => c.id),
      ["due", "grace", "d1", "d16", "d17"],
    );
  });

  it("keeps pinned customers above near-release risk customers", () => {
    const pinned = makeCustomer({
      id: "pin",
      customerName: "Pinned",
      isPinned: 1,
      pinnedAt: daysAgoIso(1),
      lastValidFollowUpAt: daysAgoIso(5),
      reclamationCycleStartedAt: daysAgoIso(5),
    });
    const oneDay = makeCustomer({
      id: "d1",
      customerName: "1d",
      lastValidFollowUpAt: daysAgoIso(RECLAIM_DAYS - 1),
      reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS - 1),
    });

    assert.ok(
      compareCustomersForList(pinned, oneDay, NOW, {
        automaticReclaimDays: RECLAIM_DAYS,
      }) < 0,
    );
  });

  it("uses default list order as tie-break for same remaining days", () => {
    const overdue = makeCustomer({
      id: "overdue",
      customerName: "Overdue",
      lastValidFollowUpAt: daysAgoIso(RECLAIM_DAYS - 8),
      reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS - 8),
      nextFollowUpAt: daysAgoIso(1),
    });
    const plain = makeCustomer({
      id: "plain",
      customerName: "Plain",
      lastValidFollowUpAt: daysAgoIso(RECLAIM_DAYS - 8),
      reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS - 8),
      nextFollowUpAt: null,
    });

    assert.ok(
      compareCustomersForList(overdue, plain, NOW, {
        automaticReclaimDays: RECLAIM_DAYS,
      }) < 0,
    );
  });

  it("does not reorder >=17-day or ineligible customers by remaining days", () => {
    const seventeen = makeCustomer({
      id: "d17",
      customerName: "17d",
      lastValidFollowUpAt: daysAgoIso(RECLAIM_DAYS - 17),
      reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS - 17),
      nextFollowUpAt: daysAgoIso(1),
    });
    const twentyNine = makeCustomer({
      id: "d29",
      customerName: "29d",
      lastValidFollowUpAt: daysAgoIso(RECLAIM_DAYS - 29),
      reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS - 29),
      nextFollowUpAt: null,
    });
    const noCountdown = makeCustomer({
      id: "plain",
      customerName: "Plain",
      lastValidFollowUpAt: daysAgoIso(5),
      reclamationCycleStartedAt: daysAgoIso(5),
      nextFollowUpAt: null,
    });

    const withRisk = sortWithRisk([twentyNine, noCountdown, seventeen]);
    const withoutRisk = sortDefaultOnly([twentyNine, noCountdown, seventeen]);

    assert.deepEqual(
      withRisk.map((c) => c.id),
      withoutRisk.map((c) => c.id),
    );
  });

  it("matches legacy default ordering when every customer is >=17 days or ineligible", () => {
    const customers = [
      makeCustomer({
        id: "d17",
        customerName: "17d",
        lastValidFollowUpAt: daysAgoIso(RECLAIM_DAYS - 17),
        reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS - 17),
        nextFollowUpAt: daysAgoIso(2),
      }),
      makeCustomer({
        id: "d20",
        customerName: "20d",
        lastValidFollowUpAt: daysAgoIso(RECLAIM_DAYS - 20),
        reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS - 20),
      }),
      makeCustomer({
        id: "d29",
        customerName: "29d",
        lastValidFollowUpAt: daysAgoIso(RECLAIM_DAYS - 29),
        reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS - 29),
        nextFollowUpAt: daysAgoIso(1),
      }),
      makeCustomer({
        id: "plain",
        customerName: "Plain",
        lastValidFollowUpAt: daysAgoIso(5),
        reclamationCycleStartedAt: daysAgoIso(5),
      }),
      makeCustomer({
        id: "pinned",
        customerName: "Pinned",
        isPinned: 1,
        pinnedAt: daysAgoIso(1),
        lastValidFollowUpAt: daysAgoIso(RECLAIM_DAYS - 20),
        reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS - 20),
      }),
    ];

    const withRisk = sortWithRisk(customers);
    const withoutRisk = sortDefaultOnly(customers);

    assert.deepEqual(
      withRisk.map((c) => c.id),
      withoutRisk.map((c) => c.id),
    );
  });

  it("excludes collaborator, public pool, and ineligible stages from risk priority", () => {
    const collaborative = new Map([["collab", true]]);
    const eligibleEight = makeCustomer({
      id: "ok8",
      customerName: "OK 8d",
      lastValidFollowUpAt: daysAgoIso(RECLAIM_DAYS - 8),
      reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS - 8),
    });
    const collabEight = makeCustomer({
      id: "collab",
      customerName: "Collab 8d",
      lastValidFollowUpAt: daysAgoIso(RECLAIM_DAYS - 8),
      reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS - 8),
    });
    const poolEight = makeCustomer({
      id: "pool",
      customerName: "Pool 8d",
      status: "public_pool",
      ownerId: null,
      lastValidFollowUpAt: daysAgoIso(RECLAIM_DAYS - 8),
      reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS - 8),
    });
    const closedWonEight = makeCustomer({
      id: "won",
      customerName: "Won 8d",
      salesStage: "closed_won",
      lastValidFollowUpAt: daysAgoIso(RECLAIM_DAYS - 8),
      reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS - 8),
    });

    assert.equal(
      getNearReleaseRiskSortKey(collabEight, RECLAIM_DAYS, NOW, {
        isCollaborative: true,
      }).riskBucket,
      1,
    );
    assert.equal(
      getNearReleaseRiskSortKey(poolEight, RECLAIM_DAYS, NOW).riskBucket,
      1,
    );
    assert.equal(
      getNearReleaseRiskSortKey(closedWonEight, RECLAIM_DAYS, NOW).riskBucket,
      1,
    );

    const sorted = sortWithRisk(
      [collabEight, poolEight, closedWonEight, eligibleEight],
      collaborative,
    );
    assert.equal(sorted[0]?.id, "ok8");
  });

  it("supports shorter automaticReclaimDays settings", () => {
    const reclaimDays = 14;
    const one = makeCustomer({
      id: "d1",
      customerName: "1d left on 14",
      lastValidFollowUpAt: daysAgoIso(13),
      reclamationCycleStartedAt: daysAgoIso(13),
    });
    const two = makeCustomer({
      id: "d2",
      customerName: "2d left on 14",
      lastValidFollowUpAt: daysAgoIso(12),
      reclamationCycleStartedAt: daysAgoIso(12),
    });

    assert.equal(getNearReleaseRiskSortKey(one, reclaimDays, NOW).riskBucket, 0);
    assert.equal(getNearReleaseRiskSortKey(two, reclaimDays, NOW).riskBucket, 0);
    assert.ok(
      compareCustomersForList(one, two, NOW, {
        automaticReclaimDays: reclaimDays,
      }) < 0,
    );
  });
});
