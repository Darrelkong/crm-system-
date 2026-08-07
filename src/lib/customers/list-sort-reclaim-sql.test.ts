import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  CUSTOMER_LIST_PAGE_SIZE,
  searchCustomersForUserPaginated,
} from "./queries";
import type { User } from "../../../drizzle/schema/users";

const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;

const FIXED_NOW = new Date("2026-08-07T04:00:00.000Z");
const RECLAIM_DAYS = 45;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const SORT_TEST_IDS = {
  countdownTwoDays: "rlsql-countdown-2d-000000000001",
  countdownFiveDays: "rlsql-countdown-5d-000000000002",
  dueExpiredGrace: "rlsql-due-grace-000000000003",
  dueNullGrace: "rlsql-due-null-000000000004",
  graceEarly: "rlsql-grace-early-000000000005",
  graceLate: "rlsql-grace-late-000000000006",
} as const;

const PAGINATION_ID_PREFIX = "rlsql-pag-";
const PAGINATION_IDS = Array.from({ length: 45 }, (_, index) => {
  const n = String(index + 1).padStart(3, "0");
  return `${PAGINATION_ID_PREFIX}${n}`;
});

const ALL_TEST_IDS = [
  ...Object.values(SORT_TEST_IDS),
  ...PAGINATION_IDS,
];

type Db = ReturnType<typeof drizzle<typeof schema>>;

function daysAgoIso(days: number): string {
  return new Date(FIXED_NOW.getTime() - days * MS_PER_DAY).toISOString();
}

function hoursFromNowIso(hours: number): string {
  return new Date(FIXED_NOW.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function buildCustomerInsert(
  db: Db,
  input: {
    id: string;
    name: string;
    ownerId: string;
    idleDaysAgo: number;
    reclaimRuleGraceUntil?: string | null;
    nextFollowUpAt?: string | null;
    createdAt?: string;
    lastValidFollowUpAt?: string;
    reclamationCycleStartedAt?: string;
  },
) {
  const anchor = daysAgoIso(input.idleDaysAgo);
  const createdAt = input.createdAt ?? anchor;
  return db.insert(schema.customers).values({
    id: input.id,
    customerCode: `RL${input.id.slice(-4)}`,
    customerName: input.name,
    nameStatus: "confirmed",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: null,
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    notes: null,
    salesStage: "negotiation",
    status: "active",
    ownerId: input.ownerId,
    createdBy: SEED_IDS.admin,
    updatedBy: SEED_IDS.admin,
    lastValidFollowUpAt: input.lastValidFollowUpAt ?? anchor,
    reclamationCycleStartedAt: input.reclamationCycleStartedAt ?? anchor,
    reclaimRuleGraceUntil: input.reclaimRuleGraceUntil ?? null,
    nextFollowUpAt: input.nextFollowUpAt ?? null,
    createdAt,
    updatedAt: createdAt,
    isPinned: 0,
  });
}

async function cleanup(db: Db) {
  await db
    .delete(schema.customerAssignees)
    .where(inArray(schema.customerAssignees.customerId, ALL_TEST_IDS));
  await db
    .delete(schema.customers)
    .where(inArray(schema.customers.id, ALL_TEST_IDS));
}

describe("reclaim_soonest SQL ordering", () => {
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

    await db.batch([
      buildCustomerInsert(db, {
        id: SORT_TEST_IDS.countdownTwoDays,
        name: "RLSQL-COUNTDOWN-2D",
        ownerId: SEED_IDS.staffB,
        idleDaysAgo: RECLAIM_DAYS - 2,
        reclaimRuleGraceUntil: hoursFromNowIso(48),
      }),
      buildCustomerInsert(db, {
        id: SORT_TEST_IDS.countdownFiveDays,
        name: "RLSQL-COUNTDOWN-5D",
        ownerId: SEED_IDS.staffB,
        idleDaysAgo: RECLAIM_DAYS - 5,
        reclaimRuleGraceUntil: null,
      }),
      buildCustomerInsert(db, {
        id: SORT_TEST_IDS.dueExpiredGrace,
        name: "RLSQL-DUE-EXPIRED-GRACE",
        ownerId: SEED_IDS.staffB,
        idleDaysAgo: RECLAIM_DAYS,
        reclaimRuleGraceUntil: daysAgoIso(1),
        nextFollowUpAt: daysAgoIso(2),
      }),
      buildCustomerInsert(db, {
        id: SORT_TEST_IDS.dueNullGrace,
        name: "RLSQL-DUE-NULL-GRACE",
        ownerId: SEED_IDS.staffB,
        idleDaysAgo: RECLAIM_DAYS,
        reclaimRuleGraceUntil: null,
        nextFollowUpAt: daysAgoIso(3),
      }),
      buildCustomerInsert(db, {
        id: SORT_TEST_IDS.graceEarly,
        name: "RLSQL-GRACE-EARLY",
        ownerId: SEED_IDS.staffB,
        idleDaysAgo: RECLAIM_DAYS + 2,
        reclaimRuleGraceUntil: hoursFromNowIso(2),
      }),
      buildCustomerInsert(db, {
        id: SORT_TEST_IDS.graceLate,
        name: "RLSQL-GRACE-LATE",
        ownerId: SEED_IDS.staffB,
        idleDaysAgo: RECLAIM_DAYS + 2,
        reclaimRuleGraceUntil: hoursFromNowIso(10),
      }),
      ...PAGINATION_IDS.map((id, index) =>
        buildCustomerInsert(db, {
          id,
          name: `RLSQL-PAG-${id.slice(-3)}`,
          ownerId: SEED_IDS.staffB,
          idleDaysAgo: RECLAIM_DAYS - (index + 1),
          ...(index === 0
            ? {
                reclamationCycleStartedAt: daysAgoIso(RECLAIM_DAYS - 1),
                lastValidFollowUpAt: daysAgoIso(1),
                createdAt: FIXED_NOW.toISOString(),
              }
            : {}),
        }),
      ),
    ] as unknown as Parameters<typeof db.batch>[0]);
  });

  after(async () => {
    await cleanup(db);
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  const reclaimOptions = {
    sortMode: "reclaim_soonest" as const,
    automaticReclaimDays: RECLAIM_DAYS,
    now: FIXED_NOW,
  };

  it("orders countdown by days remaining even when stale grace timestamps exist", async () => {
    const result = await searchCustomersForUserPaginated(
      staffB,
      "RLSQL-COUNTDOWN",
      {},
      1,
      reclaimOptions,
    );
    const ids = result.items.map((item) => item.id);
    const twoIndex = ids.indexOf(SORT_TEST_IDS.countdownTwoDays);
    const fiveIndex = ids.indexOf(SORT_TEST_IDS.countdownFiveDays);
    assert.ok(twoIndex >= 0);
    assert.ok(fiveIndex >= 0);
    assert.ok(twoIndex < fiveIndex);
  });

  it("orders due customers by default tie-break, not expired grace timestamps", async () => {
    const result = await searchCustomersForUserPaginated(
      staffB,
      "RLSQL-DUE",
      {},
      1,
      reclaimOptions,
    );
    const ids = result.items.map((item) => item.id);
    assert.deepEqual(ids, [
      SORT_TEST_IDS.dueNullGrace,
      SORT_TEST_IDS.dueExpiredGrace,
    ]);
  });

  it("orders grace customers by graceUntil ASC", async () => {
    const result = await searchCustomersForUserPaginated(
      staffB,
      "RLSQL-GRACE",
      {},
      1,
      reclaimOptions,
    );
    const ids = result.items.map((item) => item.id);
    assert.deepEqual(ids, [
      SORT_TEST_IDS.graceEarly,
      SORT_TEST_IDS.graceLate,
    ]);
  });

  it("paginates reclaim sort globally with SQL LIMIT/OFFSET", async () => {
    const page1 = await searchCustomersForUserPaginated(
      staffB,
      "RLSQL-PAG",
      {},
      1,
      reclaimOptions,
    );
    const page2 = await searchCustomersForUserPaginated(
      staffB,
      "RLSQL-PAG",
      {},
      2,
      reclaimOptions,
    );

    assert.equal(page1.items.length, CUSTOMER_LIST_PAGE_SIZE);
    assert.equal(page1.pagination.total, 45);
    assert.equal(page1.pagination.pageCount, 2);
    assert.equal(page2.items.length, 5);
    assert.equal(page1.items[0]?.id, PAGINATION_IDS[0]);

    const page1Ids = new Set(page1.items.map((item) => item.id));
    const page2Ids = new Set(page2.items.map((item) => item.id));
    for (const id of page2Ids) {
      assert.equal(page1Ids.has(id), false);
    }
  });

  it("moves the soonest reclaim customer to page 1 after sort switch", async () => {
    const defaultPage2 = await searchCustomersForUserPaginated(
      staffB,
      "RLSQL-PAG",
      {},
      2,
      { automaticReclaimDays: RECLAIM_DAYS, now: FIXED_NOW },
    );
    const reclaimPage1 = await searchCustomersForUserPaginated(
      staffB,
      "RLSQL-PAG",
      {},
      1,
      reclaimOptions,
    );

    const soonestOnDefaultPage2 = defaultPage2.items.some(
      (item) => item.id === PAGINATION_IDS[0],
    );
    assert.equal(soonestOnDefaultPage2, true);
    assert.equal(reclaimPage1.items[0]?.id, PAGINATION_IDS[0]);
  });
});
