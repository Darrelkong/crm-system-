import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
import { getStaffClaimStatusLegacy } from "./claim-limits-legacy";
import type { StaffClaimStatus } from "./constants";
import {
  getPublicPoolInstrumentation,
  resetPublicPoolInstrumentation,
} from "./public-pool-instrumentation";
import { formatPublicPoolListForUser } from "./queries";

const TEST_STAFF_ID = SEED_IDS.staffB;
const staffUser = { id: SEED_IDS.staffA, role: "staff" } as User;
const adminUser = { id: SEED_IDS.admin, role: "admin" } as User;

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

function sevenDaysAgoIso(now = FIXED_NOW): string {
  return daysAgoIso(7, now);
}

function makeClaimedCustomer(id: string, claimedAt: string): Customer {
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

function defer<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("public pool backend critical-path", () => {
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

  describe("claim-status aggregate parity (legacy vs new)", () => {
    it("1. no claims", async () => {
      await deleteTestClaimCustomers();
      await withIsolatedStaffClaims([], async () => {
        const legacy = await getStaffClaimStatusLegacy(
          TEST_STAFF_ID,
          FIXED_NOW,
          db,
        );
        const current = await getStaffClaimStatus(TEST_STAFF_ID, FIXED_NOW, db);
        assert.deepEqual(current, legacy);
        assert.equal(current.claimedInLast7Days, 0);
        assert.equal(current.canClaimNow, true);
      });
    });

    it("2. one claim within 7 days", async () => {
      await deleteTestClaimCustomers();
      await insertClaimedCustomers([
        { id: TEST_CUSTOMER_IDS[0], claimedAt: hoursAgoIso(24) },
      ]);
      await withIsolatedStaffClaims([TEST_CUSTOMER_IDS[0]], async () => {
        const legacy = await getStaffClaimStatusLegacy(
          TEST_STAFF_ID,
          FIXED_NOW,
          db,
        );
        const current = await getStaffClaimStatus(TEST_STAFF_ID, FIXED_NOW, db);
        assert.deepEqual(current, legacy);
        assert.equal(current.claimedInLast7Days, 1);
      });
    });

    it("3. multiple claims within 7 days", async () => {
      await deleteTestClaimCustomers();
      const keep = TEST_CUSTOMER_IDS.slice(0, 3);
      await insertClaimedCustomers(
        keep.map((id, index) => ({
          id,
          claimedAt: hoursAgoIso(12 + index),
        })),
      );
      await withIsolatedStaffClaims(keep, async () => {
        const legacy = await getStaffClaimStatusLegacy(
          TEST_STAFF_ID,
          FIXED_NOW,
          db,
        );
        const current = await getStaffClaimStatus(TEST_STAFF_ID, FIXED_NOW, db);
        assert.deepEqual(current, legacy);
        assert.equal(current.claimedInLast7Days, 3);
      });
    });

    it("4. claim older than 7 days only", async () => {
      await deleteTestClaimCustomers();
      await insertClaimedCustomers([
        { id: TEST_CUSTOMER_IDS[0], claimedAt: daysAgoIso(8) },
      ]);
      await withIsolatedStaffClaims([TEST_CUSTOMER_IDS[0]], async () => {
        const legacy = await getStaffClaimStatusLegacy(
          TEST_STAFF_ID,
          FIXED_NOW,
          db,
        );
        const current = await getStaffClaimStatus(TEST_STAFF_ID, FIXED_NOW, db);
        assert.deepEqual(current, legacy);
        assert.equal(current.claimedInLast7Days, 0);
      });
    });

    it("5. mix recent + old claims", async () => {
      await deleteTestClaimCustomers();
      await insertClaimedCustomers([
        { id: TEST_CUSTOMER_IDS[0], claimedAt: daysAgoIso(10) },
        { id: TEST_CUSTOMER_IDS[1], claimedAt: hoursAgoIso(48) },
        { id: TEST_CUSTOMER_IDS[2], claimedAt: hoursAgoIso(6) },
      ]);
      await withIsolatedStaffClaims(
        [TEST_CUSTOMER_IDS[0], TEST_CUSTOMER_IDS[1], TEST_CUSTOMER_IDS[2]],
        async () => {
          const legacy = await getStaffClaimStatusLegacy(
            TEST_STAFF_ID,
            FIXED_NOW,
            db,
          );
          const current = await getStaffClaimStatus(
            TEST_STAFF_ID,
            FIXED_NOW,
            db,
          );
          assert.deepEqual(current, legacy);
          assert.equal(current.claimedInLast7Days, 2);
        },
      );
    });

    it("6. claim exactly at sevenDaysAgo", async () => {
      await deleteTestClaimCustomers();
      const boundary = sevenDaysAgoIso();
      await insertClaimedCustomers([
        { id: TEST_CUSTOMER_IDS[0], claimedAt: boundary },
      ]);
      await withIsolatedStaffClaims([TEST_CUSTOMER_IDS[0]], async () => {
        const legacy = await getStaffClaimStatusLegacy(
          TEST_STAFF_ID,
          FIXED_NOW,
          db,
        );
        const current = await getStaffClaimStatus(TEST_STAFF_ID, FIXED_NOW, db);
        assert.deepEqual(current, legacy);
        assert.equal(current.claimedInLast7Days, 1);
      });
    });

    it("7. claim 1 ms before sevenDaysAgo", async () => {
      await deleteTestClaimCustomers();
      const boundary = new Date(sevenDaysAgoIso()).getTime() - 1;
      await insertClaimedCustomers([
        {
          id: TEST_CUSTOMER_IDS[0],
          claimedAt: new Date(boundary).toISOString(),
        },
      ]);
      await withIsolatedStaffClaims([TEST_CUSTOMER_IDS[0]], async () => {
        const legacy = await getStaffClaimStatusLegacy(
          TEST_STAFF_ID,
          FIXED_NOW,
          db,
        );
        const current = await getStaffClaimStatus(TEST_STAFF_ID, FIXED_NOW, db);
        assert.deepEqual(current, legacy);
        assert.equal(current.claimedInLast7Days, 0);
      });
    });

    it("8. latest claim is recent", async () => {
      await deleteTestClaimCustomers();
      await insertClaimedCustomers([
        { id: TEST_CUSTOMER_IDS[0], claimedAt: daysAgoIso(20) },
        { id: TEST_CUSTOMER_IDS[1], claimedAt: hoursAgoIso(2) },
      ]);
      await withIsolatedStaffClaims(
        [TEST_CUSTOMER_IDS[0], TEST_CUSTOMER_IDS[1]],
        async () => {
          const legacy = await getStaffClaimStatusLegacy(
            TEST_STAFF_ID,
            FIXED_NOW,
            db,
          );
          const current = await getStaffClaimStatus(
            TEST_STAFF_ID,
            FIXED_NOW,
            db,
          );
          assert.deepEqual(current, legacy);
          assert.equal(current.inCooldown, true);
        },
      );
    });

    it("9. latest claim is old", async () => {
      await deleteTestClaimCustomers();
      await insertClaimedCustomers([
        { id: TEST_CUSTOMER_IDS[0], claimedAt: hoursAgoIso(2) },
        { id: TEST_CUSTOMER_IDS[1], claimedAt: daysAgoIso(20) },
      ]);
      await withIsolatedStaffClaims(
        [TEST_CUSTOMER_IDS[0], TEST_CUSTOMER_IDS[1]],
        async () => {
          const legacy = await getStaffClaimStatusLegacy(
            TEST_STAFF_ID,
            FIXED_NOW,
            db,
          );
          const current = await getStaffClaimStatus(
            TEST_STAFF_ID,
            FIXED_NOW,
            db,
          );
          assert.deepEqual(current, legacy);
          assert.equal(current.inCooldown, true);
        },
      );
    });

    it("10. cooldown active", async () => {
      await deleteTestClaimCustomers();
      await insertClaimedCustomers([
        { id: TEST_CUSTOMER_IDS[0], claimedAt: hoursAgoIso(1) },
      ]);
      await withIsolatedStaffClaims([TEST_CUSTOMER_IDS[0]], async () => {
        const legacy = await getStaffClaimStatusLegacy(
          TEST_STAFF_ID,
          FIXED_NOW,
          db,
        );
        const current = await getStaffClaimStatus(TEST_STAFF_ID, FIXED_NOW, db);
        assert.deepEqual(current, legacy);
        assert.equal(current.inCooldown, true);
        assert.equal(current.blockedReasonKey, "cooldown");
      });
    });

    it("11. cooldown exactly expired", async () => {
      await deleteTestClaimCustomers();
      const claimedAt = hoursAgoIso(COOLDOWN_HOURS, FIXED_NOW);
      await insertClaimedCustomers([
        { id: TEST_CUSTOMER_IDS[0], claimedAt },
      ]);
      await withIsolatedStaffClaims([TEST_CUSTOMER_IDS[0]], async () => {
        const legacy = await getStaffClaimStatusLegacy(
          TEST_STAFF_ID,
          FIXED_NOW,
          db,
        );
        const current = await getStaffClaimStatus(TEST_STAFF_ID, FIXED_NOW, db);
        assert.deepEqual(current, legacy);
        assert.equal(current.inCooldown, false);
      });
    });

    it("12. quota exactly reached", async () => {
      await deleteTestClaimCustomers();
      const keep = TEST_CUSTOMER_IDS.slice(0, QUOTA_LIMIT);
      await insertClaimedCustomers(
        keep.map((id, index) => ({
          id,
          claimedAt: hoursAgoIso(24 + index),
        })),
      );
      await withIsolatedStaffClaims(keep, async () => {
        const legacy = await getStaffClaimStatusLegacy(
          TEST_STAFF_ID,
          FIXED_NOW,
          db,
        );
        const current = await getStaffClaimStatus(TEST_STAFF_ID, FIXED_NOW, db);
        assert.deepEqual(current, legacy);
        assert.equal(current.remainingQuota, 0);
        assert.equal(current.canClaimNow, false);
        assert.equal(current.blockedReasonKey, "quotaExceeded");
      });
    });

    it("13. quota exceeded", async () => {
      await deleteTestClaimCustomers();
      const keep = TEST_CUSTOMER_IDS.slice(0, QUOTA_LIMIT + 1);
      await insertClaimedCustomers(
        keep.map((id, index) => ({
          id,
          claimedAt: hoursAgoIso(12 + index),
        })),
      );
      await withIsolatedStaffClaims(keep, async () => {
        const legacy = await getStaffClaimStatusLegacy(
          TEST_STAFF_ID,
          FIXED_NOW,
          db,
        );
        const current = await getStaffClaimStatus(TEST_STAFF_ID, FIXED_NOW, db);
        assert.deepEqual(current, legacy);
        assert.ok(current.claimedInLast7Days > QUOTA_LIMIT);
        assert.equal(current.remainingQuota, 0);
      });
    });

    it("14. cooldown + quota both blocked prefers cooldown", async () => {
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
        const legacy = await getStaffClaimStatusLegacy(
          TEST_STAFF_ID,
          FIXED_NOW,
          db,
        );
        const current = await getStaffClaimStatus(TEST_STAFF_ID, FIXED_NOW, db);
        assert.deepEqual(current, legacy);
        assert.equal(current.blockedReasonKey, "cooldown");
      });
    });

    it("15. remaining quota positive", async () => {
      await deleteTestClaimCustomers();
      await insertClaimedCustomers([
        { id: TEST_CUSTOMER_IDS[0], claimedAt: hoursAgoIso(13) },
      ]);
      await withIsolatedStaffClaims([TEST_CUSTOMER_IDS[0]], async () => {
        const legacy = await getStaffClaimStatusLegacy(
          TEST_STAFF_ID,
          FIXED_NOW,
          db,
        );
        const current = await getStaffClaimStatus(TEST_STAFF_ID, FIXED_NOW, db);
        assert.deepEqual(current, legacy);
        assert.ok(current.remainingQuota > 0);
        assert.equal(current.canClaimNow, true);
      });
    });
  });

  describe("public pool output parity", () => {
    const staffStatusOk: StaffClaimStatus = {
      claimedInLast7Days: 0,
      remainingQuota: QUOTA_LIMIT,
      quotaLimit: QUOTA_LIMIT,
      cooldownHours: COOLDOWN_HOURS,
      cooldownUntil: null,
      inCooldown: false,
      canClaimNow: true,
      blockedReasonKey: null,
    };

    it("staff: sync staffStatus matches Promise staffStatus output", async () => {
      const syncItems = await formatPublicPoolListForUser(staffUser, {
        staffStatus: staffStatusOk,
      });
      const asyncItems = await formatPublicPoolListForUser(staffUser, {
        staffStatus: Promise.resolve(staffStatusOk),
      });
      assert.deepEqual(asyncItems, syncItems);
    });

    it("staff: cooldown blocked output unchanged", async () => {
      const cooldownStatus: StaffClaimStatus = {
        ...staffStatusOk,
        inCooldown: true,
        canClaimNow: false,
        blockedReasonKey: "cooldown",
        blockedReasonParams: { hours: String(COOLDOWN_HOURS) },
        cooldownUntil: new Date(FIXED_NOW.getTime() + MS_PER_HOUR).toISOString(),
      };
      const syncItems = await formatPublicPoolListForUser(staffUser, {
        staffStatus: cooldownStatus,
      });
      const asyncItems = await formatPublicPoolListForUser(staffUser, {
        staffStatus: Promise.resolve(cooldownStatus),
      });
      assert.deepEqual(asyncItems, syncItems);
      const poolItem = syncItems.find(
        (item) => item.id === SEED_IDS.customerPublicPool,
      );
      assert.ok(poolItem);
      assert.equal(poolItem.canClaim, false);
      assert.equal(poolItem.claimBlockedReasonKey, "cooldown");
    });

    it("staff: quota blocked output unchanged", async () => {
      const quotaStatus: StaffClaimStatus = {
        ...staffStatusOk,
        claimedInLast7Days: QUOTA_LIMIT,
        remainingQuota: 0,
        canClaimNow: false,
        blockedReasonKey: "quotaExceeded",
        blockedReasonParams: { limit: String(QUOTA_LIMIT) },
      };
      const items = await formatPublicPoolListForUser(staffUser, {
        staffStatus: quotaStatus,
      });
      const poolItem = items.find(
        (item) => item.id === SEED_IDS.customerPublicPool,
      );
      assert.ok(poolItem);
      assert.equal(poolItem.canClaim, false);
      assert.equal(poolItem.claimBlockedReasonKey, "quotaExceeded");
    });

    it("staff: masked fields preserved", async () => {
      const items = await formatPublicPoolListForUser(staffUser, {
        staffStatus: staffStatusOk,
      });
      const poolItem = items.find(
        (item) => item.id === SEED_IDS.customerPublicPool,
      );
      assert.ok(poolItem);
      assert.equal(poolItem.accessLevel, "masked");
      assert.equal("customerName" in poolItem, false);
      assert.equal("phone" in poolItem, false);
      assert.ok(poolItem.maskedName);
    });

    it("admin: full view output unchanged", async () => {
      const items = await formatPublicPoolListForUser(adminUser);
      const poolItem = items.find(
        (item) => item.id === SEED_IDS.customerPublicPool,
      );
      assert.ok(poolItem);
      assert.equal(poolItem.accessLevel, "full");
      if (poolItem.accessLevel === "full") {
        assert.ok(poolItem.customerName);
        assert.ok("poolReason" in poolItem);
      }
      assert.equal(poolItem.canClaim, true);
    });

    it("admin: ordering preserved (poolEnteredAt ASC)", async () => {
      const items = await formatPublicPoolListForUser(adminUser);
      const enteredAts = items.map((item) => item.poolEnteredAt ?? "");
      const sorted = [...enteredAts].sort();
      assert.deepEqual(enteredAts, sorted);
    });
  });

  describe("dependency-order orchestration", () => {
    it("customer list loads while staff claim status promise is unresolved", async () => {
      resetPublicPoolInstrumentation();
      const gate = defer<StaffClaimStatus>();
      const formatPromise = formatPublicPoolListForUser(staffUser, {
        staffStatus: gate.promise,
      });

      for (let attempt = 0; attempt < 50; attempt += 1) {
        await yieldToEventLoop();
        if (
          getPublicPoolInstrumentation().publicPoolCustomerListPhysicalLoads >=
          1
        ) {
          break;
        }
      }

      const inst = getPublicPoolInstrumentation();
      assert.equal(
        inst.publicPoolCustomerListPhysicalLoads,
        1,
        "customer list should start without waiting for claim status",
      );
      assert.equal(
        inst.publicPoolSettingsPhysicalLoads,
        0,
        "formatter should not load settings when staffStatus promise is injected",
      );
      assert.equal(
        inst.publicPoolClaimHistoryPhysicalLoads,
        0,
        "formatter should not load claim history when staffStatus promise is injected",
      );

      gate.resolve({
        claimedInLast7Days: 0,
        remainingQuota: QUOTA_LIMIT,
        quotaLimit: QUOTA_LIMIT,
        cooldownHours: COOLDOWN_HOURS,
        cooldownUntil: null,
        inCooldown: false,
        canClaimNow: true,
        blockedReasonKey: null,
      });

      await formatPromise;

      const finalInst = getPublicPoolInstrumentation();
      assert.equal(
        finalInst.publicPoolFollowUpPhysicalLoads,
        1,
        "follow-up query should run after customers without claim status",
      );
    });

    it("page pattern starts claim status and list formatting concurrently", () => {
      const page = readFileSync(
        "src/app/(dashboard)/public-pool/page.tsx",
        "utf8",
      );
      assert.match(page, /staffStatusPromise/);
      assert.match(page, /Promise\.all\(/);
      assert.match(page, /staffStatus:\s*staffStatusPromise/);
      assert.doesNotMatch(
        page,
        /await getStaffClaimStatus[\s\S]*?formatPublicPoolListForUser/,
        "page must not await claim status before starting list formatting",
      );
    });

    it("staff path uses 4 physical D1 statements via instrumentation", async () => {
      resetPublicPoolInstrumentation();
      await getStaffClaimStatus(TEST_STAFF_ID, FIXED_NOW, db);
      const inst = getPublicPoolInstrumentation();
      assert.equal(inst.publicPoolSettingsPhysicalLoads, 1);
      assert.equal(inst.publicPoolClaimHistoryPhysicalLoads, 1);

      resetPublicPoolInstrumentation();
      await formatPublicPoolListForUser(staffUser, {
        staffStatus: {
          claimedInLast7Days: 0,
          remainingQuota: QUOTA_LIMIT,
          quotaLimit: QUOTA_LIMIT,
          cooldownHours: COOLDOWN_HOURS,
          cooldownUntil: null,
          inCooldown: false,
          canClaimNow: true,
          blockedReasonKey: null,
        },
      });
      const listInst = getPublicPoolInstrumentation();
      assert.equal(listInst.publicPoolCustomerListPhysicalLoads, 1);
      assert.equal(listInst.publicPoolFollowUpPhysicalLoads, 1);
      assert.equal(listInst.publicPoolSettingsPhysicalLoads, 0);
      assert.equal(listInst.publicPoolClaimHistoryPhysicalLoads, 0);
    });

    it("admin path uses 2 physical D1 statements only", async () => {
      resetPublicPoolInstrumentation();
      await formatPublicPoolListForUser(adminUser);
      const inst = getPublicPoolInstrumentation();
      assert.equal(inst.publicPoolCustomerListPhysicalLoads, 1);
      assert.equal(inst.publicPoolFollowUpPhysicalLoads, 1);
      assert.equal(inst.publicPoolSettingsPhysicalLoads, 0);
      assert.equal(inst.publicPoolClaimHistoryPhysicalLoads, 0);
    });
  });
});
