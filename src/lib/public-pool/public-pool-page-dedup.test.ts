import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  evaluateCustomerClaimEligibility,
  formatPublicPoolListForUser,
} from "@/lib/public-pool/queries";
import type { StaffClaimStatus } from "@/lib/public-pool/constants";
import type { User } from "../../../drizzle/schema/users";

const staffUser = { id: SEED_IDS.staffA, role: "staff" } as User;
const adminUser = { id: SEED_IDS.admin, role: "admin" } as User;

const staffStatusOk: StaffClaimStatus = {
  claimedInLast7Days: 0,
  remainingQuota: 5,
  quotaLimit: 5,
  cooldownHours: 12,
  cooldownUntil: null,
  inCooldown: false,
  canClaimNow: true,
  blockedReasonKey: null,
};

describe("public pool page claim-status dedup", () => {
  let dispose: (() => Promise<void>) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    const db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
  });

  after(async () => {
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("page loads claim status once and passes it to list formatter", () => {
    const page = readFileSync(
      "src/app/(dashboard)/public-pool/page.tsx",
      "utf8",
    );
    assert.match(page, /getStaffClaimStatus/);
    assert.match(page, /formatPublicPoolListForUser\(user,\s*\{/);
    assert.match(page, /staffStatus:\s*staffClaimStatus/);
    const getStatusCount = (page.match(/await getStaffClaimStatus/g) ?? []).length;
    assert.equal(getStatusCount, 1);
  });

  it("queries formatter accepts preloaded staffStatus", () => {
    const queries = readFileSync("src/lib/public-pool/queries.ts", "utf8");
    assert.match(queries, /options\?\.staffStatus/);
    assert.match(queries, /options\?\.staffStatus \?\? \(await getStaffClaimStatus/);
  });

  it("formatPublicPoolListForUser uses provided staffStatus for eligibility", async () => {
    const quotaExceeded: StaffClaimStatus = {
      ...staffStatusOk,
      remainingQuota: 0,
      claimedInLast7Days: 5,
      canClaimNow: false,
      blockedReasonKey: "quotaExceeded",
      blockedReasonParams: { limit: "5" },
    };

    const items = await formatPublicPoolListForUser(staffUser, {
      staffStatus: quotaExceeded,
    });
    const poolItem = items.find(
      (item) => item.id === SEED_IDS.customerPublicPool,
    );
    assert.ok(poolItem);
    assert.equal(poolItem.canClaim, false);
    assert.equal(poolItem.claimBlockedReasonKey, "quotaExceeded");
    assert.equal(quotaExceeded.canClaimNow, false);
    assert.equal(quotaExceeded.blockedReasonKey, "quotaExceeded");
  });

  it("admin list remains unlimited without staff claim status", async () => {
    const items = await formatPublicPoolListForUser(adminUser);
    const poolItem = items.find(
      (item) => item.id === SEED_IDS.customerPublicPool,
    );
    assert.ok(poolItem);
    assert.equal(poolItem.canClaim, true);
    assert.equal(poolItem.accessLevel, "full");
  });

  it("staff masking unchanged on formatted list items", async () => {
    const items = await formatPublicPoolListForUser(staffUser, {
      staffStatus: staffStatusOk,
    });
    const poolItem = items.find(
      (item) => item.id === SEED_IDS.customerPublicPool,
    );
    assert.ok(poolItem);
    assert.equal("customerName" in poolItem, false);
    assert.equal("phone" in poolItem, false);
    assert.equal(poolItem.accessLevel, "masked");
  });

  it("self-release block semantics unchanged", () => {
    const customer = {
      id: "pool-1",
      status: "public_pool",
      releasedBy: SEED_IDS.staffA,
      releaserUserId: SEED_IDS.staffA,
      poolEnteredAt: new Date().toISOString(),
    } as import("../../../drizzle/schema/customers").Customer;

    const result = evaluateCustomerClaimEligibility(
      staffUser,
      customer,
      staffStatusOk,
    );
    assert.equal(result.canClaim, false);
    assert.equal(result.claimBlockedReasonKey, "selfReleased");
  });

  it("cooldown semantics unchanged when staffStatus is in cooldown", () => {
    const cooldownStatus: StaffClaimStatus = {
      ...staffStatusOk,
      inCooldown: true,
      canClaimNow: false,
      blockedReasonKey: "cooldown",
      blockedReasonParams: { hours: "12" },
      cooldownUntil: new Date(Date.now() + 3600000).toISOString(),
    };
    const customer = {
      id: "pool-2",
      status: "public_pool",
      releasedBy: null,
      releaserUserId: null,
      poolEnteredAt: "2026-01-01T00:00:00.000Z",
    } as import("../../../drizzle/schema/customers").Customer;

    const result = evaluateCustomerClaimEligibility(
      staffUser,
      customer,
      cooldownStatus,
    );
    assert.equal(result.canClaim, false);
    assert.equal(result.claimBlockedReasonKey, "cooldown");
  });
});
