import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, like, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { FollowUp } from "../../../../drizzle/schema/follow-ups";
import type { User } from "../../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { buildCustomerListWhere } from "@/lib/customers/queries";
import {
  ATTENTION_LEVELS,
  CHURN_LEVELS,
  ENGAGEMENT_STATES,
  FIRST_CONTACT_STATES,
  FOLLOW_UP_SLA_STATES,
  PROFILE_VERDICTS,
  RECLAMATION_RISK_STATES,
} from "./types";
import {
  evaluateCustomerStateReference,
  filterCustomerIdsReference,
  type StateDimensionSnapshot,
} from "./state-list-reference";
import {
  combineCustomerListWhere,
  countCustomersMatchingStateFilter,
  listCustomerIdsMatchingStateFilter,
  selectStateDimensionsForCustomers,
} from "./state-list-sql";
import type { StateListFilter } from "./state-sql-dimensions";
import {
  hkDaysAgoIso,
  hkInstant,
  hoursAgoIso,
  NOW,
} from "./state-fixtures.test-helper";

const FIXTURE_PREFIX = "77777777-7777-7777-7777-";
const FIXED_NOW = NOW;
const DEFAULT_RECLAIM_DAYS = 55;

const adminUser = { id: SEED_IDS.admin, role: "admin" } as User;
const staffUser = { id: SEED_IDS.staffA, role: "staff" } as User;

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

function fixtureId(suffix: string): string {
  return `${FIXTURE_PREFIX}${suffix.padStart(4, "0")}`;
}

function makeFixture(
  suffix: string,
  overrides: Partial<Customer> = {},
): Customer {
  const id = fixtureId(suffix);
  return {
    id,
    customerCode: null,
    customerName: "张三",
    nameStatus: "confirmed",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000000",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    requestedProjectCode: "PROJ-1",
    primaryConcern: null,
    notes: "背景说明",
    preferredName: null,
    gender: null,
    ageRange: null,
    preferredLanguage: null,
    preferredContactMethod: null,
    occupation: null,
    companyName: null,
    jobTitle: null,
    targetCountryOrRegion: null,
    salesStage: "new_lead",
    ownerId: SEED_IDS.staffA,
    status: "active",
    releaserUserId: null,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    createdBy: SEED_IDS.admin,
    updatedBy: SEED_IDS.admin,
    lastFollowUpAt: null,
    lastValidFollowUpAt: null,
    nextFollowUpAt: null,
    reclamationCycleStartedAt: null,
    reclaimRuleGraceUntil: null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: 0,
    pinnedAt: null,
    pinnedSource: null,
    collaborativeDissolvedAt: null,
    lifecycleStatus: null,
    lifecycleCompletedAt: null,
    lifecycleCompletedBy: null,
    lifecycleCompletionNotes: null,
    createdAt: FIXED_NOW.toISOString(),
    updatedAt: FIXED_NOW.toISOString(),
    ...overrides,
  } as Customer;
}

function fixtureBaseWhere(): SQL {
  return like(schema.customers.id, `${FIXTURE_PREFIX}%`);
}

async function deleteFixtures() {
  await db
    .delete(schema.customerAssignees)
    .where(like(schema.customerAssignees.id, `${FIXTURE_PREFIX}%`));
  await db
    .delete(schema.followUps)
    .where(like(schema.followUps.id, `${FIXTURE_PREFIX}%`));
  await db
    .delete(schema.customers)
    .where(like(schema.customers.id, `${FIXTURE_PREFIX}%`));
}

async function insertCustomers(customers: Customer[]) {
  for (const customer of customers) {
    await db.insert(schema.customers).values(customer);
  }
}

async function insertFollowUp(
  customerId: string,
  suffix: string,
  overrides: Partial<FollowUp> = {},
) {
  await db.insert(schema.followUps).values({
    id: fixtureId(`fu-${suffix}`),
    customerId,
    userId: SEED_IDS.staffA,
    followUpTime: hkDaysAgoIso(1),
    channel: "call",
    outcome: "no_reply",
    summary: "parity follow-up",
    content: "parity follow-up",
    isValidFollowUp: 0,
    createdAt: FIXED_NOW.toISOString(),
    ...overrides,
  });
}

async function loadFollowUps(customerIds: string[]): Promise<Map<string, FollowUp[]>> {
  if (customerIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(schema.followUps)
    .where(inArray(schema.followUps.customerId, customerIds));
  const map = new Map<string, FollowUp[]>();
  for (const row of rows) {
    const list = map.get(row.customerId) ?? [];
    list.push(row);
    map.set(row.customerId, list);
  }
  return map;
}

async function loadCollaboratorSet(customerIds: string[]): Promise<Set<string>> {
  if (customerIds.length === 0) return new Set();
  const rows = await db
    .select({ customerId: schema.customerAssignees.customerId })
    .from(schema.customerAssignees)
    .where(
      and(
        inArray(schema.customerAssignees.customerId, customerIds),
        eq(schema.customerAssignees.role, "collaborator"),
      ),
    );
  return new Set(rows.map((row) => row.customerId));
}

function queryOptions() {
  return {
    now: FIXED_NOW,
    automaticReclaimDays: DEFAULT_RECLAIM_DAYS,
    businessTimezone: "Asia/Hong_Kong" as const,
  };
}

async function evaluateReferenceSnapshots(
  customers: Customer[],
): Promise<StateDimensionSnapshot[]> {
  const ids = customers.map((c) => c.id);
  const [followUpMap, collaboratorSet] = await Promise.all([
    loadFollowUps(ids),
    loadCollaboratorSet(ids),
  ]);
  return customers.map((customer) =>
    evaluateCustomerStateReference(
      customer,
      followUpMap.get(customer.id) ?? [],
      FIXED_NOW,
      {
        hasCollaborator: collaboratorSet.has(customer.id),
        automaticReclaimDays: DEFAULT_RECLAIM_DAYS,
      },
    ),
  );
}

async function assertDimensionParity(customers: Customer[]) {
  const snapshots = await evaluateReferenceSnapshots(customers);

  for (const customer of customers) {
    const sqlRows = await selectStateDimensionsForCustomers(
      db,
      [customer.id],
      queryOptions(),
    );
    const sqlRow = sqlRows[0];
    const snapshot = snapshots.find((entry) => entry.id === customer.id);
    assert.ok(sqlRow, `missing SQL row for ${customer.id}`);
    assert.ok(snapshot, `missing JS snapshot for ${customer.id}`);
    assert.equal(sqlRow.profileVerdict, snapshot.profileVerdict, customer.id);
    assert.equal(sqlRow.firstContact, snapshot.firstContact, customer.id);
    assert.equal(sqlRow.followUpSla, snapshot.followUpSla, customer.id);
    assert.equal(sqlRow.engagement, snapshot.engagement, customer.id);
    assert.equal(sqlRow.churnLevel, snapshot.churnLevel, customer.id);
    assert.equal(sqlRow.reclamationRisk, snapshot.reclamationRisk, customer.id);
    assert.equal(sqlRow.attentionLevel, snapshot.attentionLevel, customer.id);
  }
}

async function assertFilterParity(
  customers: Customer[],
  filter: StateListFilter,
  baseWhere: SQL = fixtureBaseWhere(),
) {
  const snapshots = await evaluateReferenceSnapshots(customers);
  const refIds = filterCustomerIdsReference(snapshots, filter).sort();
  const sqlIds = (
    await listCustomerIdsMatchingStateFilter(db, baseWhere, filter, queryOptions())
  )
    .filter((id) => customers.some((c) => c.id === id))
    .sort();
  assert.deepEqual(sqlIds, refIds, `filter ${JSON.stringify(filter)}`);
}

describe("Customer State V2 SQL mirror parity", () => {
  before(async () => {
    const proxy = await getPlatformProxy<{ DB: unknown }>();
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
  });

  after(async () => {
    await deleteFixtures();
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  it("JS and SQL agree on every mirrored dimension for the fixture matrix", async () => {
    await deleteFixtures();

    const fixtures: Customer[] = [
      makeFixture("0001"),
      makeFixture("0002", {
        customerName: " ",
        nameStatus: "confirmed",
        phone: null,
        wechatId: null,
        email: null,
      }),
      makeFixture("0003", {
        customerName: "李四",
        phone: "13900000001",
        wechatId: "wx-li",
        email: "li@example.com",
        primaryConcern: "移民",
        targetCountryOrRegion: "加拿大",
        preferredContactMethod: "wechat",
        preferredName: "四哥",
        gender: "male",
        ageRange: "25-34",
        preferredLanguage: "zh",
        occupation: "经理",
        companyName: "示例",
        jobTitle: "总监",
      }),
      makeFixture("0004", {
        createdAt: hoursAgoIso(25),
        lastValidFollowUpAt: null,
      }),
      makeFixture("0005", {
        createdAt: hoursAgoIso(49),
        lastValidFollowUpAt: null,
      }),
      makeFixture("0006", {
        createdAt: hoursAgoIso(73),
        lastValidFollowUpAt: null,
      }),
      makeFixture("0007", {
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(6),
      }),
      makeFixture("0008", {
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(11),
      }),
      makeFixture("0009", {
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(21),
      }),
      makeFixture("0010", {
        salesStage: "new_lead",
        lastValidFollowUpAt: "2026-02-30T12:00:00.000Z",
      }),
      makeFixture("0011", {
        salesStage: "qualified",
        lastValidFollowUpAt: hkDaysAgoIso(2),
      }),
      makeFixture("0012", {
        ownerId: null,
        status: "public_pool",
        lastValidFollowUpAt: hkDaysAgoIso(20),
      }),
      makeFixture("0013", {
        salesStage: "on_hold",
        isPinned: 1,
        lastValidFollowUpAt: hkDaysAgoIso(20),
      }),
      makeFixture("0014", {
        salesStage: "closed_won",
        lastValidFollowUpAt: hkDaysAgoIso(3),
      }),
      makeFixture("0015", {
        salesStage: "converted",
        lastValidFollowUpAt: hkDaysAgoIso(3),
      }),
      makeFixture("0016", {
        salesStage: "closed_lost",
        lastValidFollowUpAt: hkDaysAgoIso(3),
      }),
      makeFixture("0017", {
        salesStage: "negotiating",
        lastValidFollowUpAt: hkDaysAgoIso(4),
        nextFollowUpAt: hkInstant(2026, 8, 15, 12).toISOString(),
      }),
      makeFixture("0018", {
        salesStage: "interested",
        lastValidFollowUpAt: hkDaysAgoIso(8),
        nextFollowUpAt: hkInstant(2026, 8, 17, 12).toISOString(),
      }),
      makeFixture("0019", {
        salesStage: "interested",
        lastValidFollowUpAt: hkDaysAgoIso(30),
      }),
      makeFixture("0020", {
        salesStage: "interested",
        createdAt: hkDaysAgoIso(DEFAULT_RECLAIM_DAYS - 5),
        lastValidFollowUpAt: hkDaysAgoIso(DEFAULT_RECLAIM_DAYS - 5),
      }),
      makeFixture("0021", {
        salesStage: "interested",
        lastValidFollowUpAt: hkDaysAgoIso(DEFAULT_RECLAIM_DAYS),
      }),
      makeFixture("0022", {
        customerName: "\u00a0张三\u00a0",
        notes: "has\u0000embedded",
      }),
      makeFixture("0023", {
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(10),
        isPinned: 1,
      }),
      makeFixture("0024", {
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(10),
        reclaimRuleGraceUntil: hkInstant(2026, 8, 17, 0).toISOString(),
      }),
    ];

    await insertCustomers(fixtures);

    const churnBase = fixtureId("0025");
    const churnFixtures: Customer[] = [
      makeFixture("0025", {
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(5),
      }),
      makeFixture("0026", {
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(5),
      }),
      makeFixture("0027", {
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(5),
      }),
      makeFixture("0028", {
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(5),
      }),
      makeFixture("0029", {
        salesStage: "contacted",
        lastValidFollowUpAt: hkDaysAgoIso(5),
      }),
      makeFixture("0030", {
        salesStage: "on_hold",
        isPinned: 1,
        lastValidFollowUpAt: hkDaysAgoIso(20),
      }),
    ];

    await insertCustomers(churnFixtures);

    await insertFollowUp(churnBase, "nr1", {
      outcome: "no_reply",
      followUpTime: hkDaysAgoIso(10),
    });
    await insertFollowUp(fixtureId("0025"), "nr2", {
      outcome: "no_reply",
      followUpTime: hkDaysAgoIso(9),
    });
    await insertFollowUp(fixtureId("0026"), "nc1", {
      outcome: "no_contact",
      followUpTime: hkDaysAgoIso(10),
    });
    await insertFollowUp(fixtureId("0026"), "nc2", {
      outcome: "no_contact",
      followUpTime: hkDaysAgoIso(9),
    });
    await insertFollowUp(fixtureId("0026"), "nc3", {
      outcome: "no_contact",
      followUpTime: hkDaysAgoIso(8),
    });
    await insertFollowUp(fixtureId("0027"), "mx1", {
      outcome: "no_reply",
      followUpTime: hkDaysAgoIso(10),
    });
    await insertFollowUp(fixtureId("0027"), "mx2", {
      outcome: "no_contact",
      followUpTime: hkDaysAgoIso(9),
    });
    await insertFollowUp(fixtureId("0028"), "lc1", {
      outcome: "lost_contact",
      followUpTime: hkDaysAgoIso(15),
    });
    await insertFollowUp(fixtureId("0029"), "old", {
      outcome: "no_reply",
      followUpTime: hkDaysAgoIso(61),
    });
    await insertFollowUp(fixtureId("0029"), "old2", {
      outcome: "no_reply",
      followUpTime: hkDaysAgoIso(62),
    });
    await insertFollowUp(fixtureId("0030"), "def1", {
      outcome: "no_reply",
      followUpTime: hkDaysAgoIso(5),
    });
    await insertFollowUp(fixtureId("0030"), "def2", {
      outcome: "no_reply",
      followUpTime: hkDaysAgoIso(4),
    });

    const allCustomers = [...fixtures, ...churnFixtures];

    await assertDimensionParity(allCustomers);
  });

  it("partition filters match JS reference for every enum value", async () => {
    const rows = await db
      .select()
      .from(schema.customers)
      .where(fixtureBaseWhere());
    const snapshots = await evaluateReferenceSnapshots(rows);

    for (const verdict of PROFILE_VERDICTS) {
      await assertFilterParity(rows, { profileVerdict: verdict });
    }
    for (const state of FIRST_CONTACT_STATES) {
      await assertFilterParity(rows, { firstContact: state });
    }
    for (const state of FOLLOW_UP_SLA_STATES) {
      await assertFilterParity(rows, { followUpSla: state });
    }
    for (const state of ENGAGEMENT_STATES) {
      await assertFilterParity(rows, { engagement: state });
    }
    for (const level of CHURN_LEVELS) {
      await assertFilterParity(rows, { churnLevel: level });
    }
    for (const state of RECLAMATION_RISK_STATES) {
      await assertFilterParity(rows, { reclamationRisk: state });
    }
    for (const level of ATTENTION_LEVELS) {
      await assertFilterParity(rows, { attentionLevel: level });
    }

    assert.ok(snapshots.length >= 20, "expected comprehensive fixture matrix");
  });

  it("canonical list scopes produce identical SQL and JS counts (test-only)", async () => {
    const rows = await db
      .select()
      .from(schema.customers)
      .where(fixtureBaseWhere());
    const snapshots = await evaluateReferenceSnapshots(rows);

    const scopes: Array<{ label: string; baseWhere: SQL }> = [
      {
        label: "customer_list_scope",
        baseWhere: combineCustomerListWhere(
          fixtureBaseWhere(),
          buildCustomerListWhere(adminUser, {}),
        )!,
      },
      {
        label: "staff_owned_scope",
        baseWhere: combineCustomerListWhere(
          fixtureBaseWhere(),
          buildCustomerListWhere(staffUser, {}),
        )!,
      },
      {
        label: "public_pool_scope",
        baseWhere: combineCustomerListWhere(
          fixtureBaseWhere(),
          eq(schema.customers.status, "public_pool"),
        )!,
      },
    ];

    for (const scope of scopes) {
      for (const filter of [
        {},
        { attentionLevel: "urgent" as const },
        { churnLevel: "high" as const },
        { profileVerdict: "critical_gaps" as const },
      ]) {
        const scopedRows = await db
          .select({ id: schema.customers.id })
          .from(schema.customers)
          .where(scope.baseWhere);
        const scopedIdSet = new Set(scopedRows.map((row) => row.id));
        const refCount = filterCustomerIdsReference(snapshots, filter).filter(
          (id) => scopedIdSet.has(id),
        ).length;
        const sqlCount = await countCustomersMatchingStateFilter(
          db,
          scope.baseWhere,
          filter,
          queryOptions(),
        );
        assert.equal(
          sqlCount,
          refCount,
          `${scope.label} count for ${JSON.stringify(filter)}`,
        );
      }
    }
  });
});
