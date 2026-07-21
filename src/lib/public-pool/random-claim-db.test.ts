import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  RANDOM_CLAIM_CANDIDATE_BATCH_SIZE,
  RANDOM_CLAIM_CANDIDATE_MAX_SCAN_ROWS,
  SELF_RELEASE_CLAIM_BLOCK_DAYS,
} from "@/lib/public-pool/constants";
import {
  getSelfReleaseClaimBlockState,
  listRandomClaimCandidatesForStaff,
} from "@/lib/public-pool/queries";

const FIXED_NOW = new Date("2026-06-30T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const STAFF_A = SEED_IDS.staffA;
const STAFF_B = SEED_IDS.staffB;

/**
 * Epoch-relative pool times (1990) so test rows sort before typical seed data
 * without deleting or mutating non-test public_pool customers for most tests.
 */
function epochDayIso(dayOffset: number): string {
  return new Date(Date.UTC(1990, 0, 1 + dayOffset, 12, 0, 0)).toISOString();
}

function epochMinuteIso(minuteOffset: number): string {
  return new Date(Date.UTC(1990, 0, 1, 12, 0, 0) + minuteOffset * 60_000).toISOString();
}

const IDS = {
  early: "55555555-5555-5555-5555-555555555001",
  mid: "55555555-5555-5555-5555-555555555002",
  late: "55555555-5555-5555-5555-555555555003",
  sameTimeA: "55555555-5555-5555-5555-555555555004",
  sameTimeB: "55555555-5555-5555-5555-555555555005",
  nullPoolEntered: "55555555-5555-5555-5555-555555555006",
  selfReleaseBlocked: "55555555-5555-5555-5555-555555555007",
  selfReleaseExpired: "55555555-5555-5555-5555-555555555008",
  otherReleased: "55555555-5555-5555-5555-555555555009",
  active: "55555555-5555-5555-5555-555555555010",
  archived: "55555555-5555-5555-5555-555555555011",
  inactive: "55555555-5555-5555-5555-555555555012",
  deletedPool: "55555555-5555-5555-5555-555555555013",
  exactDay7: "55555555-5555-5555-5555-555555555014",
  legacyReleaser: "55555555-5555-5555-5555-555555555015",
  fillPrefix: "55555555-5555-5555-5555-5555555551",
} as const;

const FILL_IDS = Array.from(
  { length: 12 },
  (_, i) => `${IDS.fillPrefix}${String(i).padStart(2, "0")}`,
);

/** Contiguous IDs for scan-cap suites (000..300). */
function scanCapId(index: number): string {
  return `55555555-5555-5555-a5c0-${String(index).padStart(12, "0")}`;
}

const SCAN_CAP_IDS = Array.from({ length: 301 }, (_, i) => scanCapId(i));

const ALL_TEST_IDS = [
  IDS.early,
  IDS.mid,
  IDS.late,
  IDS.sameTimeA,
  IDS.sameTimeB,
  IDS.nullPoolEntered,
  IDS.selfReleaseBlocked,
  IDS.selfReleaseExpired,
  IDS.otherReleased,
  IDS.active,
  IDS.archived,
  IDS.inactive,
  IDS.deletedPool,
  IDS.exactDay7,
  IDS.legacyReleaser,
  ...FILL_IDS,
  ...SCAN_CAP_IDS,
];

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

function makePoolCustomer(
  id: string,
  overrides: Partial<Customer> = {},
): Customer {
  const now = FIXED_NOW.toISOString();
  const phoneSuffix = id.replace(/\D/g, "").slice(-8);
  return {
    id,
    customerCode: null,
    customerName: `[TEST] Random claim ${id.slice(-4)}`,
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: `139${phoneSuffix.padStart(8, "0")}`,
    wechatId: "secret-wechat",
    email: "secret@example.com",
    source: "referral",
    sourceRemark: "secret remark",
    requestedProjectName: "測試項目",
    notes: "secret notes",
    salesStage: "new_lead",
    ownerId: null,
    status: "public_pool",
    releaserUserId: null,
    poolEnteredAt: now,
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

/** D1 rejects large multi-row inserts (bound-parameter limit). */
async function insertCustomers(rows: Customer[]) {
  const batchSize = 2;
  for (let i = 0; i < rows.length; i += batchSize) {
    await db.insert(schema.customers).values(rows.slice(i, i + batchSize));
  }
}

async function deleteByIds(ids: string[]) {
  const chunkSize = 40;
  for (let i = 0; i < ids.length; i += chunkSize) {
    await db
      .delete(schema.customers)
      .where(inArray(schema.customers.id, ids.slice(i, i + chunkSize)));
  }
}

async function cleanup() {
  await deleteByIds(ALL_TEST_IDS);
}

/**
 * Temporarily soft-delete non-test public_pool rows so scan-cap sentinel
 * assertions are not polluted by seed data. Restored in finally.
 */
async function withIsolatedPublicPool<T>(
  keepIds: string[],
  fn: () => Promise<T>,
): Promise<T> {
  const keep = new Set(keepIds);
  const livePool = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.status, "public_pool"),
        isNull(schema.customers.deletedAt),
      ),
    );
  const otherIds = livePool.map((row) => row.id).filter((id) => !keep.has(id));
  const marker = "1990-01-01T00:00:00.000Z";

  const chunkSize = 40;
  for (let i = 0; i < otherIds.length; i += chunkSize) {
    await db
      .update(schema.customers)
      .set({ deletedAt: marker })
      .where(inArray(schema.customers.id, otherIds.slice(i, i + chunkSize)));
  }

  try {
    return await fn();
  } finally {
    for (let i = 0; i < otherIds.length; i += chunkSize) {
      await db
        .update(schema.customers)
        .set({ deletedAt: null })
        .where(inArray(schema.customers.id, otherIds.slice(i, i + chunkSize)));
    }
  }
}

describe("listRandomClaimCandidatesForStaff", () => {
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

  it("returns oldest public_pool candidates first and excludes non-pool statuses", async () => {
    await cleanup();
    await insertCustomers([
      makePoolCustomer(IDS.late, { poolEnteredAt: epochDayIso(5) }),
      makePoolCustomer(IDS.early, { poolEnteredAt: epochDayIso(1) }),
      makePoolCustomer(IDS.mid, { poolEnteredAt: epochDayIso(3) }),
      makePoolCustomer(IDS.active, {
        status: "active",
        ownerId: STAFF_B,
        poolEnteredAt: null,
        poolReason: null,
      }),
      makePoolCustomer(IDS.archived, {
        status: "archived",
        poolEnteredAt: epochDayIso(0),
      }),
      makePoolCustomer(IDS.inactive, {
        status: "inactive",
        poolEnteredAt: epochDayIso(0),
      }),
    ]);

    const result = await listRandomClaimCandidatesForStaff({
      userId: STAFF_A,
      limit: 10,
      now: FIXED_NOW,
      db,
    });

    const ids = result.candidates.map((c) => c.id);
    assert.deepEqual(ids.slice(0, 3), [IDS.early, IDS.mid, IDS.late]);
    assert.equal(ids.includes(IDS.active), false);
    assert.equal(ids.includes(IDS.archived), false);
    assert.equal(ids.includes(IDS.inactive), false);
    assert.equal(result.scanLimitReached, false);
  });

  it("uses id ASC when effective poolEnteredAt is equal", async () => {
    await cleanup();
    const same = epochDayIso(2);
    await insertCustomers([
      makePoolCustomer(IDS.sameTimeB, { poolEnteredAt: same }),
      makePoolCustomer(IDS.sameTimeA, { poolEnteredAt: same }),
    ]);

    const result = await listRandomClaimCandidatesForStaff({
      userId: STAFF_A,
      limit: 10,
      now: FIXED_NOW,
      db,
    });

    assert.deepEqual(
      result.candidates.map((c) => c.id).slice(0, 2),
      [IDS.sameTimeA, IDS.sameTimeB],
    );
    assert.equal(result.scanLimitReached, false);
  });

  it("falls back to createdAt when poolEnteredAt is NULL", async () => {
    await cleanup();
    await insertCustomers([
      makePoolCustomer(IDS.late, {
        poolEnteredAt: epochDayIso(5),
        createdAt: epochDayIso(5),
      }),
      makePoolCustomer(IDS.nullPoolEntered, {
        poolEnteredAt: null,
        createdAt: epochDayIso(2),
      }),
      makePoolCustomer(IDS.early, {
        poolEnteredAt: epochDayIso(1),
        createdAt: epochDayIso(1),
      }),
    ]);

    const result = await listRandomClaimCandidatesForStaff({
      userId: STAFF_A,
      limit: 10,
      now: FIXED_NOW,
      db,
    });

    assert.deepEqual(
      result.candidates.map((c) => c.id).slice(0, 3),
      [IDS.early, IDS.nullPoolEntered, IDS.late],
    );
  });

  it("caps at batch size 10 and allows smaller test limits", async () => {
    await cleanup();
    await insertCustomers(
      FILL_IDS.map((id, i) =>
        makePoolCustomer(id, {
          poolEnteredAt: epochDayIso(i + 1),
        }),
      ),
    );

    const capped = await listRandomClaimCandidatesForStaff({
      userId: STAFF_A,
      limit: 99,
      now: FIXED_NOW,
      db,
    });
    assert.equal(capped.candidates.length, RANDOM_CLAIM_CANDIDATE_BATCH_SIZE);
    assert.deepEqual(
      capped.candidates.map((c) => c.id),
      FILL_IDS.slice(0, RANDOM_CLAIM_CANDIDATE_BATCH_SIZE),
    );
    assert.equal(capped.scanLimitReached, false);

    const small = await listRandomClaimCandidatesForStaff({
      userId: STAFF_A,
      limit: 3,
      now: FIXED_NOW,
      db,
    });
    assert.equal(small.candidates.length, 3);
    assert.deepEqual(
      small.candidates.map((c) => c.id),
      FILL_IDS.slice(0, 3),
    );

    const one = await listRandomClaimCandidatesForStaff({
      userId: STAFF_A,
      limit: 1,
      now: FIXED_NOW,
      db,
    });
    assert.equal(one.candidates.length, 1);

    const zero = await listRandomClaimCandidatesForStaff({
      userId: STAFF_A,
      limit: 0,
      now: FIXED_NOW,
      db,
    });
    assert.equal(zero.candidates.length, 1);

    const negative = await listRandomClaimCandidatesForStaff({
      userId: STAFF_A,
      limit: -1,
      now: FIXED_NOW,
      db,
    });
    assert.equal(negative.candidates.length, 1);

    const nanLimit = await listRandomClaimCandidatesForStaff({
      userId: STAFF_A,
      limit: Number.NaN,
      now: FIXED_NOW,
      db,
    });
    assert.equal(nanLimit.candidates.length, RANDOM_CLAIM_CANDIDATE_BATCH_SIZE);

    const infinityLimit = await listRandomClaimCandidatesForStaff({
      userId: STAFF_A,
      limit: Number.POSITIVE_INFINITY,
      now: FIXED_NOW,
      db,
    });
    assert.equal(
      infinityLimit.candidates.length,
      RANDOM_CLAIM_CANDIDATE_BATCH_SIZE,
    );

    const fractional = await listRandomClaimCandidatesForStaff({
      userId: STAFF_A,
      limit: 3.9,
      now: FIXED_NOW,
      db,
    });
    assert.equal(fractional.candidates.length, 3);
  });

  it("excludes self-released customers still inside the block window", async () => {
    await cleanup();
    assert.equal(SELF_RELEASE_CLAIM_BLOCK_DAYS, 7);

    const selfReleaseNow = new Date(Date.UTC(1990, 0, 20, 12, 0, 0));

    await insertCustomers([
      makePoolCustomer(IDS.selfReleaseBlocked, {
        poolEnteredAt: epochDayIso(18),
        releasedBy: STAFF_A,
        releaserUserId: STAFF_A,
      }),
      makePoolCustomer(IDS.selfReleaseExpired, {
        poolEnteredAt: epochDayIso(10),
        releasedBy: STAFF_A,
        releaserUserId: STAFF_A,
      }),
      makePoolCustomer(IDS.otherReleased, {
        poolEnteredAt: epochDayIso(19),
        releasedBy: STAFF_B,
        releaserUserId: STAFF_B,
      }),
      makePoolCustomer(IDS.early, {
        poolEnteredAt: epochDayIso(1),
        releasedBy: null,
      }),
    ]);

    const forStaffA = await listRandomClaimCandidatesForStaff({
      userId: STAFF_A,
      limit: 10,
      now: selfReleaseNow,
      db,
    });
    const idsA = forStaffA.candidates.map((c) => c.id);
    assert.equal(idsA.includes(IDS.selfReleaseBlocked), false);
    assert.equal(idsA.includes(IDS.selfReleaseExpired), true);
    assert.equal(idsA.includes(IDS.otherReleased), true);
    assert.equal(idsA.includes(IDS.early), true);

    const forStaffB = await listRandomClaimCandidatesForStaff({
      userId: STAFF_B,
      limit: 10,
      now: selfReleaseNow,
      db,
    });
    const idsB = forStaffB.candidates.map((c) => c.id);
    assert.equal(idsB.includes(IDS.selfReleaseBlocked), true);
    assert.equal(idsB.includes(IDS.otherReleased), false);
  });

  it("includes self-released customer when now equals blockedUntil", async () => {
    await cleanup();
    const poolEnteredAt = epochDayIso(1);
    const blockedUntil = new Date(
      new Date(poolEnteredAt).getTime() +
        SELF_RELEASE_CLAIM_BLOCK_DAYS * MS_PER_DAY,
    );
    const helperState = getSelfReleaseClaimBlockState(
      {
        releasedBy: STAFF_A,
        releaserUserId: STAFF_A,
        poolEnteredAt,
      } as Customer,
      STAFF_A,
      blockedUntil,
    );
    assert.ok(helperState);
    assert.equal(helperState.blocked, false);

    await insertCustomers([
      makePoolCustomer(IDS.exactDay7, {
        poolEnteredAt,
        releasedBy: STAFF_A,
        releaserUserId: STAFF_A,
      }),
    ]);

    const result = await listRandomClaimCandidatesForStaff({
      userId: STAFF_A,
      limit: 10,
      now: blockedUntil,
      db,
    });
    assert.equal(
      result.candidates.some((c) => c.id === IDS.exactDay7),
      true,
    );
  });

  it("excludes legacy releaserUserId-only self-release inside the window", async () => {
    await cleanup();
    const selfReleaseNow = new Date(Date.UTC(1990, 0, 5, 12, 0, 0));
    await insertCustomers([
      makePoolCustomer(IDS.legacyReleaser, {
        poolEnteredAt: epochDayIso(1),
        releasedBy: null,
        releaserUserId: STAFF_A,
      }),
    ]);

    const helperState = getSelfReleaseClaimBlockState(
      {
        releasedBy: null,
        releaserUserId: STAFF_A,
        poolEnteredAt: epochDayIso(1),
      } as Customer,
      STAFF_A,
      selfReleaseNow,
    );
    assert.ok(helperState);
    assert.equal(helperState.blocked, true);

    const result = await listRandomClaimCandidatesForStaff({
      userId: STAFF_A,
      limit: 10,
      now: selfReleaseNow,
      db,
    });
    assert.equal(
      result.candidates.some((c) => c.id === IDS.legacyReleaser),
      false,
    );
  });

  it("skips soft-deleted public_pool rows", async () => {
    await cleanup();
    await insertCustomers([
      makePoolCustomer(IDS.deletedPool, {
        poolEnteredAt: epochDayIso(0),
        deletedAt: FIXED_NOW.toISOString(),
        deletedBy: SEED_IDS.admin,
      }),
      makePoolCustomer(IDS.early, { poolEnteredAt: epochDayIso(1) }),
    ]);

    const result = await listRandomClaimCandidatesForStaff({
      userId: STAFF_A,
      limit: 10,
      now: FIXED_NOW,
      db,
    });
    const ids = result.candidates.map((c) => c.id);
    assert.equal(ids.includes(IDS.deletedPool), false);
    assert.equal(ids[0], IDS.early);
  });

  it("continues scanning past blocked self-releases to fill the batch", async () => {
    await cleanup();
    const scanNow = new Date(Date.UTC(1990, 0, 6, 12, 0, 0));
    const blocked = FILL_IDS.slice(0, 5).map((id, i) =>
      makePoolCustomer(id, {
        poolEnteredAt: epochDayIso(i),
        releasedBy: STAFF_A,
        releaserUserId: STAFF_A,
      }),
    );
    const open = FILL_IDS.slice(5, 8).map((id, i) =>
      makePoolCustomer(id, {
        poolEnteredAt: epochDayIso(10 + i),
        releasedBy: null,
      }),
    );
    await insertCustomers([...blocked, ...open]);

    const result = await listRandomClaimCandidatesForStaff({
      userId: STAFF_A,
      limit: 3,
      now: scanNow,
      db,
      pageSize: 2,
    });

    assert.equal(result.candidates.length, 3);
    assert.deepEqual(
      result.candidates.map((c) => c.id),
      open.map((c) => c.id),
    );
    assert.equal(result.scanLimitReached, false);
  });

  it("returns only minimal non-PII fields on candidates and scan metadata", async () => {
    await cleanup();
    await insertCustomers([
      makePoolCustomer(IDS.early, { poolEnteredAt: epochDayIso(1) }),
    ]);

    const result = await listRandomClaimCandidatesForStaff({
      userId: STAFF_A,
      limit: 1,
      now: FIXED_NOW,
      db,
    });
    assert.deepEqual(Object.keys(result).sort(), [
      "candidates",
      "scanLimitReached",
      "scannedRows",
    ]);
    const [candidate] = result.candidates;
    assert.ok(candidate);
    assert.equal(candidate.id, IDS.early);
    assert.deepEqual(Object.keys(candidate).sort(), [
      "createdAt",
      "id",
      "poolEnteredAt",
      "releasedBy",
    ]);
    assert.equal(JSON.stringify(candidate).includes("secret"), false);
    assert.equal(JSON.stringify(candidate).includes("139"), false);
  });

  it("A: 300 blocked + 301st eligible → empty candidates with scanLimitReached", async () => {
    await cleanup();
    assert.equal(RANDOM_CLAIM_CANDIDATE_MAX_SCAN_ROWS, 300);
    const scanNow = new Date(Date.UTC(1990, 0, 2, 12, 0, 0));
    const blocked = SCAN_CAP_IDS.slice(0, 300).map((id, i) =>
      makePoolCustomer(id, {
        poolEnteredAt: epochMinuteIso(i),
        releasedBy: STAFF_A,
        releaserUserId: STAFF_A,
      }),
    );
    const eligible = makePoolCustomer(SCAN_CAP_IDS[300]!, {
      poolEnteredAt: epochMinuteIso(300),
      releasedBy: STAFF_B,
      releaserUserId: STAFF_B,
    });

    await insertCustomers([...blocked, eligible]);

    await withIsolatedPublicPool(SCAN_CAP_IDS, async () => {
      const result = await listRandomClaimCandidatesForStaff({
        userId: STAFF_A,
        now: scanNow,
        db,
      });
      assert.equal(result.candidates.length, 0);
      assert.equal(result.scannedRows, 300);
      assert.equal(result.scanLimitReached, true);
      assert.equal(
        result.candidates.some((c) => c.id === SCAN_CAP_IDS[300]),
        false,
      );
    });
  });

  it("B: exactly 300 blocked and no further rows → scanLimitReached false", async () => {
    await cleanup();
    const scanNow = new Date(Date.UTC(1990, 0, 2, 12, 0, 0));
    const blockedIds = SCAN_CAP_IDS.slice(0, 300);
    const blocked = blockedIds.map((id, i) =>
      makePoolCustomer(id, {
        poolEnteredAt: epochMinuteIso(i),
        releasedBy: STAFF_A,
        releaserUserId: STAFF_A,
      }),
    );
    await insertCustomers(blocked);

    await withIsolatedPublicPool(blockedIds, async () => {
      const result = await listRandomClaimCandidatesForStaff({
        userId: STAFF_A,
        now: scanNow,
        db,
      });
      assert.equal(result.candidates.length, 0);
      assert.equal(result.scannedRows, 300);
      assert.equal(result.scanLimitReached, false);
    });
  });

  it("C: fewer than maxScanRows all blocked → scanLimitReached false", async () => {
    await cleanup();
    const scanNow = new Date(Date.UTC(1990, 0, 2, 12, 0, 0));
    const blockedIds = SCAN_CAP_IDS.slice(0, 40);
    const blocked = blockedIds.map((id, i) =>
      makePoolCustomer(id, {
        poolEnteredAt: epochMinuteIso(i),
        releasedBy: STAFF_A,
        releaserUserId: STAFF_A,
      }),
    );
    await insertCustomers(blocked);

    await withIsolatedPublicPool(blockedIds, async () => {
      const result = await listRandomClaimCandidatesForStaff({
        userId: STAFF_A,
        now: scanNow,
        db,
      });
      assert.equal(result.candidates.length, 0);
      assert.equal(result.scannedRows, 40);
      assert.equal(result.scanLimitReached, false);
    });
  });

  it("D: filling 10 candidates leaves scanLimitReached false even with more rows", async () => {
    await cleanup();
    const open = FILL_IDS.slice(0, 12).map((id, i) =>
      makePoolCustomer(id, {
        poolEnteredAt: epochDayIso(i + 1),
        releasedBy: null,
      }),
    );
    await insertCustomers(open);

    const result = await listRandomClaimCandidatesForStaff({
      userId: STAFF_A,
      now: FIXED_NOW,
      db,
    });
    assert.equal(result.candidates.length, 10);
    assert.equal(result.scanLimitReached, false);
    assert.ok(result.scannedRows >= 10);
  });
});
