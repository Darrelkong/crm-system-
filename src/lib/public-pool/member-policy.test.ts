import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  getPublicPoolMemberPolicy,
  validatePublicPoolPolicyOverride,
} from "./member-policy";

describe("public-pool member policy", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let dispose: (() => Promise<void>) | undefined;
  let original: {
    firstLoginAt: string | null;
    createdAt: string;
    poolClaimPaused: number;
    poolClaimQuotaOverride: number | null;
    poolClaimCooldownHoursOverride: number | null;
  };

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    original = (
      await db
        .select({
          firstLoginAt: schema.users.firstLoginAt,
        createdAt: schema.users.createdAt,
          poolClaimPaused: schema.users.poolClaimPaused,
          poolClaimQuotaOverride: schema.users.poolClaimQuotaOverride,
          poolClaimCooldownHoursOverride:
            schema.users.poolClaimCooldownHoursOverride,
        })
        .from(schema.users)
        .where(eq(schema.users.id, SEED_IDS.staffA))
        .limit(1)
    )[0]!;
  });

  after(async () => {
    await db
      .update(schema.users)
      .set(original)
      .where(eq(schema.users.id, SEED_IDS.staffA));
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("enforces the 45-day boundary and member overrides", async () => {
    const firstLoginAt = "2026-09-07T12:00:00.000Z";
    await db
      .update(schema.users)
      .set({
        firstLoginAt,
        poolClaimPaused: 0,
        poolClaimQuotaOverride: 20,
        poolClaimCooldownHoursOverride: 24,
      })
      .where(eq(schema.users.id, SEED_IDS.staffA));

    const beforeBoundary = await getPublicPoolMemberPolicy(
      db,
      SEED_IDS.staffA,
      new Date("2026-10-22T11:59:59.000Z"),
    );
    assert.equal(beforeBoundary.canClaimByMemberPolicy, false);
    assert.equal(beforeBoundary.blockedReasonKey, "newMemberProtection");
    assert.equal(beforeBoundary.effectiveQuota, 20);
    assert.equal(beforeBoundary.effectiveCooldownHours, 24);

    const atBoundary = await getPublicPoolMemberPolicy(
      db,
      SEED_IDS.staffA,
      new Date("2026-10-22T12:00:00.000Z"),
    );
    assert.equal(atBoundary.canClaimByMemberPolicy, true);

    await db
      .update(schema.users)
      .set({ poolClaimPaused: 1 })
      .where(eq(schema.users.id, SEED_IDS.staffA));
    const paused = await getPublicPoolMemberPolicy(
      db,
      SEED_IDS.staffA,
      new Date("2026-11-01T00:00:00.000Z"),
    );
    assert.equal(paused.blockedReasonKey, "adminPaused");
  });

  it("keeps pre-rollout staff without login evidence eligible", async () => {
    await db
      .update(schema.users)
      .set({
        firstLoginAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        poolClaimPaused: 0,
        poolClaimQuotaOverride: null,
        poolClaimCooldownHoursOverride: null,
      })
      .where(eq(schema.users.id, SEED_IDS.staffA));

    const policy = await getPublicPoolMemberPolicy(
      db,
      SEED_IDS.staffA,
      new Date("2026-09-07T00:00:00.000Z"),
    );

    assert.equal(policy.firstLoginAt, null);
    assert.equal(policy.eligibilityAt, null);
    assert.equal(policy.remainingProtectionDays, 0);
    assert.equal(policy.canClaimByMemberPolicy, true);
    assert.equal(policy.blockedReasonKey, null);
  });

  it("validates bounded optional overrides", () => {
    assert.deepEqual(validatePublicPoolPolicyOverride(0, 720), {
      ok: true,
      quotaOverride: 0,
      cooldownHoursOverride: 720,
    });
    assert.equal(validatePublicPoolPolicyOverride(-1, 1).ok, false);
    assert.equal(validatePublicPoolPolicyOverride(101, 1).ok, false);
    assert.equal(validatePublicPoolPolicyOverride(null, 721).ok, false);
  });
});
