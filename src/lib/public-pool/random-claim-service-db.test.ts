import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { getStaffClaimStatus } from "@/lib/public-pool/claim-limits";
import {
  RANDOM_CLAIM_CANDIDATE_BATCH_SIZE,
} from "@/lib/public-pool/constants";
import { claimRandomCustomerFromPoolForStaff } from "@/lib/public-pool/random-claim-service";
import {
  buildStaffClaimGuardParams,
  claimCustomerFromPool,
} from "@/lib/public-pool/service";

const FIXED_NOW = new Date("2026-06-30T12:00:00.000Z");
const MS_PER_HOUR = 60 * 60 * 1000;

const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;

const IDS = {
  poolA: "66666666-6666-6666-6666-666666666001",
  poolB: "66666666-6666-6666-6666-666666666002",
  poolC: "66666666-6666-6666-6666-666666666003",
  claimed1: "66666666-6666-6666-6666-666666666101",
  claimed2: "66666666-6666-6666-6666-666666666102",
  claimed3: "66666666-6666-6666-6666-666666666103",
  claimed4: "66666666-6666-6666-6666-666666666104",
  scan0: "66666666-6666-6666-6666-66666666a000",
  scan1: "66666666-6666-6666-6666-66666666a001",
  scan2: "66666666-6666-6666-6666-66666666a002",
  scan3: "66666666-6666-6666-6666-66666666a003",
} as const;

const ALL_IDS = Object.values(IDS);

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

function epochMinuteIso(minuteOffset: number): string {
  return new Date(
    Date.UTC(1990, 0, 1, 12, 0, 0) + minuteOffset * 60_000,
  ).toISOString();
}

function hoursAgoIso(hours: number, now = FIXED_NOW): string {
  return new Date(now.getTime() - hours * MS_PER_HOUR).toISOString();
}

function makePoolCustomer(
  id: string,
  overrides: Partial<Customer> = {},
): Customer {
  const now = FIXED_NOW.toISOString();
  const phoneSuffix = id.replace(/\D/g, "").slice(-8);
  return {
    id,
    customerCode: `RC-${id.slice(-4)}`,
    customerName: `[TEST] Random svc ${id.slice(-4)}`,
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: `138${phoneSuffix.padStart(8, "0")}`,
    wechatId: "secret-wechat",
    email: "secret@example.com",
    source: "referral",
    sourceRemark: "secret",
    requestedProjectName: "測試項目",
    notes: "secret notes",
    salesStage: "new_lead",
    ownerId: null,
    status: "public_pool",
    releaserUserId: null,
    poolEnteredAt: epochMinuteIso(1),
    poolReason: "test",
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
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: 0,
    pinnedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Customer;
}

function makeClaimedCustomer(
  id: string,
  claimedBy: string,
  claimedAt: string,
): Customer {
  return makePoolCustomer(id, {
    status: "active",
    ownerId: claimedBy,
    claimedBy,
    claimedAt,
    poolEnteredAt: null,
    poolReason: null,
    poolLeftAt: claimedAt,
    customerCode: null,
  });
}

async function insertCustomers(rows: Customer[]) {
  for (let i = 0; i < rows.length; i += 2) {
    await db.insert(schema.customers).values(rows.slice(i, i + 2));
  }
}

async function deleteByIds(ids: string[]) {
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    await db.delete(schema.tasks).where(inArray(schema.tasks.customerId, chunk));
    await db
      .delete(schema.customerAssignees)
      .where(inArray(schema.customerAssignees.customerId, chunk));
    await db
      .delete(schema.auditLogs)
      .where(inArray(schema.auditLogs.entityId, chunk));
    await db.delete(schema.customers).where(inArray(schema.customers.id, chunk));
  }
}

async function cleanup() {
  await deleteByIds(ALL_IDS);
}

async function withIsolatedPublicPool<T>(
  keepIds: string[],
  fn: () => Promise<T>,
): Promise<T> {
  const keep = new Set(keepIds);
  const live = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.status, "public_pool"),
        isNull(schema.customers.deletedAt),
      ),
    );
  const otherIds = live.map((r) => r.id).filter((id) => !keep.has(id));
  const marker = "1990-01-01T00:00:00.000Z";
  for (let i = 0; i < otherIds.length; i += 40) {
    await db
      .update(schema.customers)
      .set({ deletedAt: marker })
      .where(inArray(schema.customers.id, otherIds.slice(i, i + 40)));
  }
  try {
    return await fn();
  } finally {
    for (let i = 0; i < otherIds.length; i += 40) {
      await db
        .update(schema.customers)
        .set({ deletedAt: null })
        .where(inArray(schema.customers.id, otherIds.slice(i, i + 40)));
    }
  }
}

/**
 * Park foreign claimed_at rows for staff so quota/cooldown reflect only keepIds.
 * Restores originals afterwards. Needed when shared local D1 has leftover claims.
 */
async function withIsolatedStaffClaimHistory<T>(
  staffIds: string[],
  keepCustomerIds: string[],
  fn: () => Promise<T>,
): Promise<T> {
  const keep = new Set(keepCustomerIds);
  const rows = await db
    .select({
      id: schema.customers.id,
      claimedAt: schema.customers.claimedAt,
    })
    .from(schema.customers)
    .where(inArray(schema.customers.claimedBy, staffIds));

  const parkIso = "1990-01-01T00:00:00.000Z";
  const originals: Array<{ id: string; claimedAt: string }> = [];
  for (const row of rows) {
    if (!row.claimedAt || keep.has(row.id)) continue;
    originals.push({ id: row.id, claimedAt: row.claimedAt });
    await db
      .update(schema.customers)
      .set({ claimedAt: parkIso })
      .where(eq(schema.customers.id, row.id));
  }

  try {
    return await fn();
  } finally {
    for (const orig of originals) {
      await db
        .update(schema.customers)
        .set({ claimedAt: orig.claimedAt })
        .where(eq(schema.customers.id, orig.id));
    }
  }
}

async function withIsolatedClaimEnv<T>(
  options: {
    poolKeepIds: string[];
    staffIds: string[];
    claimKeepIds?: string[];
  },
  fn: () => Promise<T>,
): Promise<T> {
  return withIsolatedStaffClaimHistory(
    options.staffIds,
    options.claimKeepIds ?? options.poolKeepIds,
    () => withIsolatedPublicPool(options.poolKeepIds, fn),
  );
}

async function countOwnedBy(userId: string, ids: string[]) {
  const rows = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.ownerId, userId),
        inArray(schema.customers.id, ids),
      ),
    );
  return rows.length;
}

/**
 * Arrival barrier: all callers reach the hook, then all proceed together.
 * Subsequent calls after release pass through (supports different-staff retry).
 * Does not use setTimeout to fake concurrency — timeout only fails the test if
 * a party never arrives (deadlock / polluted fixture).
 */
function createAtomicClaimBarrier(partySize: number, timeoutMs = 15_000) {
  let arrived = 0;
  let released = false;
  let releaseAll!: () => void;
  const allArrived = new Promise<void>((resolve) => {
    releaseAll = resolve;
  });

  return {
    beforeAtomicClaimAttempt: async () => {
      if (released) return;
      arrived += 1;
      if (arrived === partySize) {
        released = true;
        releaseAll();
      }
      await Promise.race([
        allArrived,
        new Promise<void>((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(
                `atomic claim barrier timeout: arrived=${arrived}/${partySize}`,
              ),
            );
          }, timeoutMs);
        }),
      ]);
    },
    getArrivedCount: () => arrived,
  };
}

/** Keep list order stable so first candidate is always index 0. */
const keepCandidateOrder = (upperExclusive: number) => upperExclusive - 1;

async function countSuccessAudits(customerIds: string[]) {
  const rows = await db
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        inArray(schema.auditLogs.entityId, customerIds),
        eq(schema.auditLogs.action, "customer.claimed_from_pool"),
      ),
    );
  return rows.length;
}

async function countFirstContactTasks(customerIds: string[]) {
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        inArray(schema.tasks.customerId, customerIds),
        eq(schema.tasks.type, "first_contact"),
      ),
    );
  return rows.length;
}

describe("claimRandomCustomerFromPoolForStaff", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("successfully claims one eligible customer with assignee task and audit", async () => {
    await cleanup();
    // Keep staffB outside cooldown: no recent claims by staffB in fixtures.
    const customer = makePoolCustomer(IDS.poolA, {
      poolEnteredAt: epochMinuteIso(1),
    });
    await insertCustomers([customer]);

    await withIsolatedClaimEnv(
      {
        poolKeepIds: [IDS.poolA],
        staffIds: [SEED_IDS.staffB],
      },
      async () => {
      const result = await claimRandomCustomerFromPoolForStaff({
        user: staffB,
        now: FIXED_NOW,
        db,
        randomSource: () => 0,
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal(result.customerId, IDS.poolA);
      assert.equal(result.customerName, customer.customerName);
      assert.equal(result.customerCode, customer.customerCode);
      assert.ok(result.taskId);
      assert.equal(JSON.stringify(result).includes("secret"), false);
      assert.equal(JSON.stringify(result).includes("138"), false);

      const row = (
        await db
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.id, IDS.poolA))
          .limit(1)
      )[0];
      assert.equal(row?.status, "active");
      assert.equal(row?.ownerId, SEED_IDS.staffB);
      assert.equal(row?.claimedBy, SEED_IDS.staffB);
      assert.ok(row?.claimedAt);
      assert.ok(row?.poolLeftAt);

      const assignees = await db
        .select()
        .from(schema.customerAssignees)
        .where(eq(schema.customerAssignees.customerId, IDS.poolA));
      assert.equal(assignees.length, 1);
      assert.equal(assignees[0]?.userId, SEED_IDS.staffB);

      const tasks = await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.customerId, IDS.poolA));
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0]?.type, "first_contact");

      const audits = await db
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.entityId, IDS.poolA),
            eq(schema.auditLogs.action, "customer.claimed_from_pool"),
          ),
        );
      assert.ok(audits.length >= 1);
      const meta = JSON.parse(audits[0]!.metadata ?? "{}") as Record<
        string,
        unknown
      >;
      assert.equal(meta.claimMethod, "random_oldest_batch");
      assert.equal(meta.candidateBatchSize, RANDOM_CLAIM_CANDIDATE_BATCH_SIZE);
      assert.equal("candidateIds" in meta, false);
    });
  });

  it("returns PUBLIC_POOL_NO_ELIGIBLE_CUSTOMER when pool has no claimable rows", async () => {
    await cleanup();
    await withIsolatedClaimEnv(
      {
        poolKeepIds: [],
        staffIds: [SEED_IDS.staffA],
      },
      async () => {
      const result = await claimRandomCustomerFromPoolForStaff({
        user: staffA,
        now: FIXED_NOW,
        db,
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.errorCode, "PUBLIC_POOL_NO_ELIGIBLE_CUSTOMER");
      assert.equal(result.httpStatus, 404);
    });
  });

  it("returns PUBLIC_POOL_CANDIDATE_SCAN_LIMIT without writing customers", async () => {
    await cleanup();
    const blocked = [IDS.scan0, IDS.scan1, IDS.scan2].map((id, i) =>
      makePoolCustomer(id, {
        poolEnteredAt: hoursAgoIso(2 - i * 0.1),
        releasedBy: SEED_IDS.staffA,
        releaserUserId: SEED_IDS.staffA,
      }),
    );
    const eligible = makePoolCustomer(IDS.scan3, {
      poolEnteredAt: hoursAgoIso(0.5),
      releasedBy: SEED_IDS.staffB,
      releaserUserId: SEED_IDS.staffB,
    });
    await insertCustomers([...blocked, eligible]);

    await withIsolatedClaimEnv(
      {
        poolKeepIds: [IDS.scan0, IDS.scan1, IDS.scan2, IDS.scan3],
        staffIds: [SEED_IDS.staffA],
      },
      async () => {
        const result = await claimRandomCustomerFromPoolForStaff({
          user: staffA,
          now: FIXED_NOW,
          db,
          maxScanRows: 3,
        });
        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.errorCode, "PUBLIC_POOL_CANDIDATE_SCAN_LIMIT");
        assert.equal(result.httpStatus, 503);
        assert.equal(result.scannedRows, 3);

        const stillPool = await db
          .select({ id: schema.customers.id, status: schema.customers.status })
          .from(schema.customers)
          .where(inArray(schema.customers.id, [IDS.scan3]));
        assert.equal(stillPool[0]?.status, "public_pool");

        const tasks = await db
          .select()
          .from(schema.tasks)
          .where(eq(schema.tasks.customerId, IDS.scan3));
        assert.equal(tasks.length, 0);
      },
    );
  });

  it("retries next candidate after already_claimed race", async () => {
    await cleanup();
    await insertCustomers([
      makePoolCustomer(IDS.poolA, { poolEnteredAt: epochMinuteIso(1) }),
      makePoolCustomer(IDS.poolB, { poolEnteredAt: epochMinuteIso(2) }),
    ]);

    await withIsolatedClaimEnv(
      {
        poolKeepIds: [IDS.poolA, IDS.poolB],
        staffIds: [SEED_IDS.staffA, SEED_IDS.staffB],
      },
      async () => {
      // Pre-claim first candidate as staffA so staffB's first attempt fails.
      const first = (
        await db
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.id, IDS.poolA))
          .limit(1)
      )[0]!;
      const pre = await claimCustomerFromPool(first, staffA, {
        now: new Date(hoursAgoIso(13)),
        db,
      });
      assert.equal(pre.ok, true);

      const result = await claimRandomCustomerFromPoolForStaff({
        user: staffB,
        now: FIXED_NOW,
        db,
        // Keep candidate order [poolA, poolB] so first attempt hits already-claimed poolA.
        randomSource: (upper) => upper - 1,
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.customerId, IDS.poolB);
    });
  });

  it("different staff concurrent claim on same customer: only one wins", async () => {
    await cleanup();
    await insertCustomers([
      makePoolCustomer(IDS.poolA, { poolEnteredAt: epochMinuteIso(1) }),
    ]);

    await withIsolatedClaimEnv(
      {
        poolKeepIds: [IDS.poolA],
        staffIds: [SEED_IDS.staffA, SEED_IDS.staffB],
      },
      async () => {
      const customer = (
        await db
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.id, IDS.poolA))
          .limit(1)
      )[0]!;
      const guardsA = await buildStaffClaimGuardParams(
        staffA.id,
        FIXED_NOW,
        db,
      );
      const guardsB = await buildStaffClaimGuardParams(
        staffB.id,
        FIXED_NOW,
        db,
      );

      const [resultA, resultB] = await Promise.all([
        claimCustomerFromPool(customer, staffA, {
          now: FIXED_NOW,
          db,
          staffGuards: guardsA,
        }),
        claimCustomerFromPool(customer, staffB, {
          now: FIXED_NOW,
          db,
          staffGuards: guardsB,
        }),
      ]);

      const wins = [resultA, resultB].filter((r) => r.ok);
      assert.equal(wins.length, 1);

      const owners = await db
        .select({ ownerId: schema.customers.ownerId })
        .from(schema.customers)
        .where(eq(schema.customers.id, IDS.poolA));
      assert.ok(
        owners[0]?.ownerId === SEED_IDS.staffA ||
          owners[0]?.ownerId === SEED_IDS.staffB,
      );

      const tasks = await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.customerId, IDS.poolA));
      assert.equal(tasks.length, 1);
    });
  });

  it("same staff cooldown race: both pass precheck then only one wins", async () => {
    await cleanup();
    await insertCustomers([
      makePoolCustomer(IDS.poolA, { poolEnteredAt: epochMinuteIso(1) }),
      makePoolCustomer(IDS.poolB, { poolEnteredAt: epochMinuteIso(2) }),
    ]);

    await withIsolatedClaimEnv(
      {
        poolKeepIds: [IDS.poolA, IDS.poolB],
        staffIds: [SEED_IDS.staffB],
      },
      async () => {
      const statusBefore = await getStaffClaimStatus(
        SEED_IDS.staffB,
        FIXED_NOW,
        db,
      );
      assert.equal(statusBefore.inCooldown, false);
      assert.ok(statusBefore.canClaimNow);

      const barrier = createAtomicClaimBarrier(2);

      const [a, b] = await Promise.all([
        claimRandomCustomerFromPoolForStaff({
          user: staffB,
          now: FIXED_NOW,
          db,
          randomSource: keepCandidateOrder,
          beforeAtomicClaimAttempt: barrier.beforeAtomicClaimAttempt,
        }),
        claimRandomCustomerFromPoolForStaff({
          user: staffB,
          now: FIXED_NOW,
          db,
          randomSource: keepCandidateOrder,
          beforeAtomicClaimAttempt: barrier.beforeAtomicClaimAttempt,
        }),
      ]);

      assert.equal(barrier.getArrivedCount(), 2);

      const successes = [a, b].filter((r) => r.ok);
      const failures = [a, b].filter((r) => !r.ok);
      assert.equal(successes.length, 1);
      assert.equal(failures.length, 1);
      if (!failures[0]!.ok) {
        assert.equal(failures[0]!.errorCode, "CLAIM_COOLDOWN");
      }

      assert.equal(
        await countOwnedBy(SEED_IDS.staffB, [IDS.poolA, IDS.poolB]),
        1,
      );
      assert.equal(await countFirstContactTasks([IDS.poolA, IDS.poolB]), 1);
      assert.equal(await countSuccessAudits([IDS.poolA, IDS.poolB]), 1);

      const stillPool = await db
        .select({
          id: schema.customers.id,
          status: schema.customers.status,
          ownerId: schema.customers.ownerId,
        })
        .from(schema.customers)
        .where(inArray(schema.customers.id, [IDS.poolA, IDS.poolB]));
      const poolRows = stillPool.filter((r) => r.status === "public_pool");
      assert.equal(poolRows.length, 1);
      assert.equal(poolRows[0]?.ownerId, null);
    });
  });

  it("same staff quota race: cooldown=0 so failure is CLAIM_QUOTA_EXCEEDED", async () => {
    await cleanup();
    // Default quota is 5. Seed 4 claims inside the 7-day window, outside default cooldown.
    await insertCustomers([
      makeClaimedCustomer(IDS.claimed1, SEED_IDS.staffB, hoursAgoIso(13)),
      makeClaimedCustomer(IDS.claimed2, SEED_IDS.staffB, hoursAgoIso(14)),
      makeClaimedCustomer(IDS.claimed3, SEED_IDS.staffB, hoursAgoIso(15)),
      makeClaimedCustomer(IDS.claimed4, SEED_IDS.staffB, hoursAgoIso(16)),
      makePoolCustomer(IDS.poolA, { poolEnteredAt: epochMinuteIso(1) }),
      makePoolCustomer(IDS.poolB, { poolEnteredAt: epochMinuteIso(2) }),
    ]);

    await withIsolatedClaimEnv(
      {
        poolKeepIds: [IDS.poolA, IDS.poolB],
        staffIds: [SEED_IDS.staffB],
        claimKeepIds: [
          IDS.claimed1,
          IDS.claimed2,
          IDS.claimed3,
          IDS.claimed4,
          IDS.poolA,
          IDS.poolB,
        ],
      },
      async () => {
      const statusBefore = await getStaffClaimStatus(
        SEED_IDS.staffB,
        FIXED_NOW,
        db,
      );
      assert.equal(statusBefore.claimedInLast7Days, 4);
      assert.equal(statusBefore.remainingQuota, 1);
      assert.equal(statusBefore.inCooldown, false);
      assert.ok(statusBefore.canClaimNow);

      const barrier = createAtomicClaimBarrier(2);

      const [a, b] = await Promise.all([
        claimRandomCustomerFromPoolForStaff({
          user: staffB,
          now: FIXED_NOW,
          db,
          randomSource: keepCandidateOrder,
          // Test-only: disable cooldown so quota guard is the sole blocker.
          cooldownHoursOverride: 0,
          beforeAtomicClaimAttempt: barrier.beforeAtomicClaimAttempt,
        }),
        claimRandomCustomerFromPoolForStaff({
          user: staffB,
          now: FIXED_NOW,
          db,
          randomSource: keepCandidateOrder,
          cooldownHoursOverride: 0,
          beforeAtomicClaimAttempt: barrier.beforeAtomicClaimAttempt,
        }),
      ]);

      assert.equal(barrier.getArrivedCount(), 2);

      const successes = [a, b].filter((r) => r.ok);
      const failures = [a, b].filter((r) => !r.ok);
      assert.equal(successes.length, 1);
      assert.equal(failures.length, 1);
      if (!failures[0]!.ok) {
        assert.equal(failures[0]!.errorCode, "CLAIM_QUOTA_EXCEEDED");
        assert.notEqual(failures[0]!.errorCode, "CLAIM_COOLDOWN");
      }

      const statusAfter = await getStaffClaimStatus(
        SEED_IDS.staffB,
        FIXED_NOW,
        db,
      );
      assert.equal(statusAfter.claimedInLast7Days, 5);
      assert.equal(statusAfter.remainingQuota, 0);

      assert.equal(
        await countOwnedBy(SEED_IDS.staffB, [IDS.poolA, IDS.poolB]),
        1,
      );
      assert.equal(await countFirstContactTasks([IDS.poolA, IDS.poolB]), 1);
      assert.equal(await countSuccessAudits([IDS.poolA, IDS.poolB]), 1);

      const stillPool = await db
        .select({
          id: schema.customers.id,
          status: schema.customers.status,
          ownerId: schema.customers.ownerId,
        })
        .from(schema.customers)
        .where(inArray(schema.customers.id, [IDS.poolA, IDS.poolB]));
      const poolRows = stillPool.filter((r) => r.status === "public_pool");
      assert.equal(poolRows.length, 1);
      assert.equal(poolRows[0]?.ownerId, null);
    });
  });

  it("different staff retry: loser of first candidate claims second", async () => {
    await cleanup();
    await insertCustomers([
      makePoolCustomer(IDS.poolA, { poolEnteredAt: epochMinuteIso(1) }),
      makePoolCustomer(IDS.poolB, { poolEnteredAt: epochMinuteIso(2) }),
    ]);

    const barrier = createAtomicClaimBarrier(2);

    await withIsolatedClaimEnv(
      {
        poolKeepIds: [IDS.poolA, IDS.poolB],
        staffIds: [SEED_IDS.staffA, SEED_IDS.staffB],
      },
      async () => {
      const [resultA, resultB] = await Promise.all([
        claimRandomCustomerFromPoolForStaff({
          user: staffA,
          now: FIXED_NOW,
          db,
          randomSource: keepCandidateOrder,
          beforeAtomicClaimAttempt: barrier.beforeAtomicClaimAttempt,
        }),
        claimRandomCustomerFromPoolForStaff({
          user: staffB,
          now: FIXED_NOW,
          db,
          randomSource: keepCandidateOrder,
          beforeAtomicClaimAttempt: barrier.beforeAtomicClaimAttempt,
        }),
      ]);

      assert.equal(barrier.getArrivedCount(), 2);
      assert.equal(resultA.ok, true);
      assert.equal(resultB.ok, true);
      if (!resultA.ok || !resultB.ok) return;

      const claimedIds = new Set([resultA.customerId, resultB.customerId]);
      assert.deepEqual(claimedIds, new Set([IDS.poolA, IDS.poolB]));

      const owners = await db
        .select({
          id: schema.customers.id,
          ownerId: schema.customers.ownerId,
        })
        .from(schema.customers)
        .where(inArray(schema.customers.id, [IDS.poolA, IDS.poolB]));
      assert.equal(owners.length, 2);
      const ownerIds = new Set(owners.map((r) => r.ownerId));
      assert.deepEqual(ownerIds, new Set([SEED_IDS.staffA, SEED_IDS.staffB]));

      const assignees = await db
        .select()
        .from(schema.customerAssignees)
        .where(inArray(schema.customerAssignees.customerId, [IDS.poolA, IDS.poolB]));
      assert.equal(assignees.length, 2);
      const primaryByCustomer = new Map(
        assignees.map((a) => [a.customerId, a.userId]),
      );
      assert.equal(primaryByCustomer.size, 2);

      assert.equal(await countFirstContactTasks([IDS.poolA, IDS.poolB]), 2);
      assert.equal(await countSuccessAudits([IDS.poolA, IDS.poolB]), 2);
    });
  });

  it("admin id-claim path still works without staff guards", async () => {
    await cleanup();
    const customer = makePoolCustomer(IDS.poolA, {
      poolEnteredAt: epochMinuteIso(1),
    });
    await insertCustomers([customer]);
    const admin = { id: SEED_IDS.admin, role: "admin" } as User;
    const result = await claimCustomerFromPool(customer, admin, {
      now: FIXED_NOW,
      db,
    });
    assert.equal(result.ok, true);
  });
});
