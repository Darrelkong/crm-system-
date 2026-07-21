import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { SETTING_DEFAULTS } from "@/lib/settings/keys";
import { getStaffClaimStatus } from "./claim-limits";
import { evaluateCustomerClaimEligibility } from "./queries";

const TEST_STAFF_ID = SEED_IDS.staffB;
const TEST_ADMIN = { id: SEED_IDS.admin, role: "admin" } as User;
const TEST_STAFF = { id: TEST_STAFF_ID, role: "staff" } as User;

const TEST_CUSTOMER_IDS = [
  "44444444-4444-4444-4444-444444444401",
  "44444444-4444-4444-4444-444444444402",
  "44444444-4444-4444-4444-444444444403",
  "44444444-4444-4444-4444-444444444404",
  "44444444-4444-4444-4444-444444444405",
  "44444444-4444-4444-4444-444444444406",
  "44444444-4444-4444-4444-444444444407",
] as const;

const FIXED_NOW = new Date("2026-06-30T12:00:00.000Z");
const QUOTA_LIMIT = Number(SETTING_DEFAULTS.public_pool_claim_quota_7_days);
const COOLDOWN_HOURS = Number(SETTING_DEFAULTS.public_pool_claim_cooldown_hours);
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

function hoursAgoIso(hours: number, now = FIXED_NOW): string {
  return new Date(now.getTime() - hours * MS_PER_HOUR).toISOString();
}

function daysAgoIso(days: number, now = FIXED_NOW): string {
  return new Date(now.getTime() - days * MS_PER_DAY).toISOString();
}

function makeClaimedCustomer(
  id: string,
  claimedAt: string,
): Customer {
  const now = FIXED_NOW.toISOString();
  return {
    id,
    customerCode: null,
    customerName: `[TEST] Pool claim ${id.slice(-2)}`,
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000001",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: "測試項目",
    notes: null,
    salesStage: "new_lead",
    ownerId: TEST_STAFF_ID,
    status: "active",
    releaserUserId: null,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: TEST_STAFF_ID,
    claimedAt,
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
  } as Customer;
}

async function deleteTestClaimCustomers() {
  await db
    .delete(schema.customers)
    .where(inArray(schema.customers.id, [...TEST_CUSTOMER_IDS]));
}

/**
 * Park foreign claimed_at rows for the test staff so status reflects only
 * TEST_CUSTOMER_IDS fixtures (shared local D1 may retain leftover claims).
 */
async function withIsolatedStaffClaims<T>(
  keepIds: readonly string[],
  fn: () => Promise<T>,
): Promise<T> {
  const keep = new Set(keepIds);
  const rows = await db
    .select({
      id: schema.customers.id,
      claimedAt: schema.customers.claimedAt,
    })
    .from(schema.customers)
    .where(eq(schema.customers.claimedBy, TEST_STAFF_ID));

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

async function insertClaimedCustomers(
  entries: Array<{ id: string; claimedAt: string }>,
) {
  for (const { id, claimedAt } of entries) {
    await db
      .insert(schema.customers)
      .values(makeClaimedCustomer(id, claimedAt));
  }
}

describe("getStaffClaimStatus", () => {
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
    await deleteTestClaimCustomers();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("allows claim when under quota and outside cooldown", async () => {
    await deleteTestClaimCustomers();
    await insertClaimedCustomers([
      { id: TEST_CUSTOMER_IDS[0], claimedAt: hoursAgoIso(13) },
    ]);

    await withIsolatedStaffClaims([TEST_CUSTOMER_IDS[0]], async () => {
      const status = await getStaffClaimStatus(TEST_STAFF_ID, FIXED_NOW, db);

      assert.equal(status.canClaimNow, true);
      assert.equal(status.blockedReasonKey, null);
      assert.equal(status.claimedInLast7Days, 1);
      assert.equal(status.remainingQuota, QUOTA_LIMIT - 1);
    });
  });

  it("blocks claim when 7-day quota is reached", async () => {
    await deleteTestClaimCustomers();
    const keep = TEST_CUSTOMER_IDS.slice(0, QUOTA_LIMIT);
    await insertClaimedCustomers(
      keep.map((id, index) => ({
        id,
        claimedAt: hoursAgoIso(24 + index),
      })),
    );

    await withIsolatedStaffClaims(keep, async () => {
      const status = await getStaffClaimStatus(TEST_STAFF_ID, FIXED_NOW, db);

      assert.equal(status.canClaimNow, false);
      assert.equal(status.blockedReasonKey, "quotaExceeded");
      assert.equal(status.claimedInLast7Days, QUOTA_LIMIT);
      assert.equal(status.remainingQuota, 0);
    });
  });

  it("blocks claim during cooldown after a recent claim", async () => {
    await deleteTestClaimCustomers();
    await insertClaimedCustomers([
      { id: TEST_CUSTOMER_IDS[0], claimedAt: hoursAgoIso(1) },
    ]);

    await withIsolatedStaffClaims([TEST_CUSTOMER_IDS[0]], async () => {
      const status = await getStaffClaimStatus(TEST_STAFF_ID, FIXED_NOW, db);

      assert.equal(status.canClaimNow, false);
      assert.equal(status.blockedReasonKey, "cooldown");
      assert.equal(status.inCooldown, true);
      assert.ok(status.cooldownUntil);
    });
  });

  it("prefers cooldown over quota when both would block", async () => {
    await deleteTestClaimCustomers();
    const keep = TEST_CUSTOMER_IDS.slice(0, QUOTA_LIMIT);
    await insertClaimedCustomers(
      keep.map((id, index) => ({
        id,
        claimedAt:
          index === 0 ? hoursAgoIso(1) : hoursAgoIso(24 + index),
      })),
    );

    await withIsolatedStaffClaims(keep, async () => {
      const status = await getStaffClaimStatus(TEST_STAFF_ID, FIXED_NOW, db);

      assert.equal(status.canClaimNow, false);
      assert.equal(status.blockedReasonKey, "cooldown");
      assert.notEqual(status.blockedReasonKey, "quotaExceeded");
    });
  });

  it("excludes claims older than 7 days from rolling quota", async () => {
    await deleteTestClaimCustomers();
    const keep = [
      TEST_CUSTOMER_IDS[0],
      ...TEST_CUSTOMER_IDS.slice(1, QUOTA_LIMIT),
    ];
    await insertClaimedCustomers([
      { id: TEST_CUSTOMER_IDS[0], claimedAt: daysAgoIso(8) },
      ...TEST_CUSTOMER_IDS.slice(1, QUOTA_LIMIT).map((id, index) => ({
        id,
        claimedAt: hoursAgoIso(12 + index),
      })),
    ]);

    await withIsolatedStaffClaims(keep, async () => {
      const status = await getStaffClaimStatus(TEST_STAFF_ID, FIXED_NOW, db);

      assert.equal(status.claimedInLast7Days, QUOTA_LIMIT - 1);
      assert.equal(status.canClaimNow, true);
      assert.equal(status.blockedReasonKey, null);
    });
  });
});

describe("evaluateCustomerClaimEligibility admin bypass", () => {
  const poolCustomer = {
    id: "22222222-2222-2222-2222-222222222203",
    status: "public_pool",
  } as Customer;

  it("allows admin to claim self-released pool customer within block window", () => {
    const customer = {
      id: "22222222-2222-2222-2222-222222222203",
      status: "public_pool",
      releasedBy: SEED_IDS.admin,
      poolEnteredAt: new Date().toISOString(),
    } as Customer;

    const result = evaluateCustomerClaimEligibility(
      TEST_ADMIN,
      customer,
      null,
    );

    assert.equal(result.canClaim, true);
    assert.equal(result.claimBlockedReasonKey, null);
  });

  it("allows admin to claim regardless of staff cooldown/quota status", () => {
    const blockedStaffStatus = {
      claimedInLast7Days: QUOTA_LIMIT,
      remainingQuota: 0,
      quotaLimit: QUOTA_LIMIT,
      cooldownHours: COOLDOWN_HOURS,
      cooldownUntil: new Date(FIXED_NOW.getTime() + MS_PER_HOUR).toISOString(),
      inCooldown: true,
      canClaimNow: false,
      blockedReasonKey: "cooldown",
    };

    const result = evaluateCustomerClaimEligibility(
      TEST_ADMIN,
      poolCustomer,
      blockedStaffStatus,
    );

    assert.equal(result.canClaim, true);
    assert.equal(result.claimBlockedReasonKey, null);
  });

  it("applies staff quota block when staff status is exhausted", () => {
    const exhaustedStaffStatus = {
      claimedInLast7Days: QUOTA_LIMIT,
      remainingQuota: 0,
      quotaLimit: QUOTA_LIMIT,
      cooldownHours: COOLDOWN_HOURS,
      cooldownUntil: null,
      inCooldown: false,
      canClaimNow: false,
      blockedReasonKey: "quotaExceeded",
      blockedReasonParams: { limit: String(QUOTA_LIMIT) },
    };

    const result = evaluateCustomerClaimEligibility(
      TEST_STAFF,
      poolCustomer,
      exhaustedStaffStatus,
    );

    assert.equal(result.canClaim, false);
    assert.equal(result.claimBlockedReasonKey, "quotaExceeded");
  });
});
