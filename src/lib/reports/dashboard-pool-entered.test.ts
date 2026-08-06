import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";
import { getBusinessTodayRange } from "@/lib/reports/dates";
import { buildPublicPoolEnteredTodayWhere } from "./dashboard-summary";

describe("public pool entered today metric", () => {
  it("counts by poolEnteredAt without requiring current public_pool status", () => {
    const service = readFileSync(
      "src/lib/reports/dashboard-summary.ts",
      "utf8",
    );
    assert.match(service, /buildPublicPoolEnteredTodayWhere/);
    assert.doesNotMatch(
      service,
      /eq\(schema\.customers\.status,\s*"public_pool"\).*poolEnteredAt|poolEnteredAt[\s\S]{0,200}eq\(schema\.customers\.status,\s*"public_pool"\)/,
    );

    const whereCall = service.slice(
      service.indexOf("buildPublicPoolEnteredTodayWhere"),
    );
    assert.doesNotMatch(
      whereCall.slice(0, 400),
      /status,\s*"public_pool"/,
    );
  });

  it("claim path keeps poolEnteredAt so claimed customers remain countable", () => {
    const claim = readFileSync("src/lib/public-pool/service.ts", "utf8");
    assert.match(claim, /export async function claimCustomerFromPool/);
    const claimUpdate = claim.slice(
      claim.indexOf("export async function claimCustomerFromPool"),
      claim.indexOf("export async function claimCustomerFromPool") + 2500,
    );
    assert.match(claimUpdate, /status:\s*"active"/);
    assert.match(claimUpdate, /poolLeftAt:\s*now/);
    assert.doesNotMatch(claimUpdate, /poolEnteredAt:\s*null/);
  });

  it("release paths set poolEnteredAt on entry", () => {
    const release = readFileSync("src/lib/public-pool/service.ts", "utf8");
    assert.match(release, /poolEnteredAt:\s*now/);
    const engine = readFileSync("src/lib/reclamation/engine.ts", "utf8");
    assert.match(engine, /poolEnteredAt:\s*now/);
  });

  it("builds a HK today range filter for poolEnteredAt", () => {
    const now = new Date("2026-08-06T04:00:00.000Z");
    const { start, end } = getBusinessTodayRange(now, HONG_KONG_TIMEZONE);
    const tomorrowStart = new Date(new Date(end).getTime() + 1).toISOString();
    const where = buildPublicPoolEnteredTodayWhere(start, tomorrowStart);
    assert.ok(where);
    assert.ok(where.queryChunks.length > 0);
    assert.ok(start < tomorrowStart);
  });

  it("HK midnight and late-day bounds stay on the same calendar day for mid-day entries", () => {
    const midDay = new Date("2026-08-06T04:00:00.000Z");
    const { start, end } = getBusinessTodayRange(midDay, HONG_KONG_TIMEZONE);
    assert.ok(start <= midDay.toISOString());
    assert.ok(end >= midDay.toISOString());

    const justBeforeMidnight = new Date("2026-08-06T15:59:00.000Z");
    const { start: s2, end: e2 } = getBusinessTodayRange(
      justBeforeMidnight,
      HONG_KONG_TIMEZONE,
    );
    assert.equal(s2, start);
    assert.equal(e2, end);
  });
});
