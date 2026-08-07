import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import {
  buildRiskEpisodeKey,
  getAutomaticReclaimRuleState,
} from "./reclaim-rule-version";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let previousReclaimDays: string | null = null;
let previousWarningDaysBefore: string | null = null;

async function readSetting(key: string): Promise<string | null> {
  const row = await db
    .select()
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .limit(1);
  return row[0]?.value ?? null;
}

async function upsertSetting(key: string, value: string): Promise<void> {
  const now = new Date().toISOString();
  const existing = await readSetting(key);
  if (existing === value) return;
  const row = await db
    .select()
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .limit(1);
  if (row[0]) {
    await db
      .update(schema.systemSettings)
      .set({ value, updatedAt: now })
      .where(eq(schema.systemSettings.key, key));
    return;
  }
  await db.insert(schema.systemSettings).values({ key, value, updatedAt: now });
}

describe("automatic reclaim rule version", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    process.env.WRANGLER_LOG_PATH = join(
      mkdtempSync(join(tmpdir(), "wrangler-logs-")),
      "wrangler.log",
    );
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
    previousReclaimDays = await readSetting("automatic_reclaim_days");
    previousWarningDaysBefore = await readSetting("reclaim_warning_days_before");
  });

  after(async () => {
    if (previousReclaimDays != null) {
      await upsertSetting("automatic_reclaim_days", previousReclaimDays);
    }
    if (previousWarningDaysBefore != null) {
      await upsertSetting("reclaim_warning_days_before", previousWarningDaysBefore);
    }
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    delete process.env.WRANGLER_LOG_PATH;
    await disposeProxy?.();
  });

  it("does not change rule version when warningDaysBefore changes", async () => {
    await upsertSetting("automatic_reclaim_days", "45");
    const before = await getAutomaticReclaimRuleState(db);
    await upsertSetting("reclaim_warning_days_before", "2");
    const after = await getAutomaticReclaimRuleState(db);
    assert.equal(after.ruleVersion, before.ruleVersion);
    assert.equal(after.reclaimDays, 45);
  });

  it("does not change rule version when an unrelated setting changes", async () => {
    await upsertSetting("automatic_reclaim_days", "45");
    const before = await getAutomaticReclaimRuleState(db);
    await upsertSetting("global_idle_timeout_exempt_enabled", "true");
    const after = await getAutomaticReclaimRuleState(db);
    assert.equal(after.ruleVersion, before.ruleVersion);
  });

  it("does not change rule version when saving the same automatic_reclaim_days value", async () => {
    await upsertSetting("automatic_reclaim_days", "45");
    const first = await getAutomaticReclaimRuleState(db);
    await upsertSetting("automatic_reclaim_days", "45");
    const second = await getAutomaticReclaimRuleState(db);
    assert.equal(second.ruleVersion, first.ruleVersion);
    assert.equal(second.reclaimDays, 45);
  });

  it("changes rule version when automatic_reclaim_days value changes", async () => {
    await upsertSetting("automatic_reclaim_days", "45");
    const at45 = await getAutomaticReclaimRuleState(db);
    await upsertSetting("automatic_reclaim_days", "60");
    const at60 = await getAutomaticReclaimRuleState(db);
    assert.notEqual(at60.ruleVersion, at45.ruleVersion);
    assert.equal(at60.reclaimDays, 60);

    await upsertSetting("automatic_reclaim_days", "45");
    const at45Again = await getAutomaticReclaimRuleState(db);
    assert.notEqual(at45Again.ruleVersion, at45.ruleVersion);
    assert.notEqual(at45Again.ruleVersion, at60.ruleVersion);
    assert.equal(at45Again.reclaimDays, 45);
  });

  it("builds risk episode keys without warningDaysBefore", () => {
    const key = buildRiskEpisodeKey({
      customerId: "cust-1",
      ownerId: "owner-1",
      cycleStartedAt: "2026-07-01T00:00:00.000Z",
      reclaimDays: 45,
      reclaimRuleVersion: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(
      key,
      "cust-1:owner-1:2026-07-01T00:00:00.000Z:45:2026-01-01T00:00:00.000Z",
    );
    assert.doesNotMatch(key, /warning/i);
  });
});
