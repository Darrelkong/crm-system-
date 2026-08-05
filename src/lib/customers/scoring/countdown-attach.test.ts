import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getEffectiveSettings } from "@/lib/settings/effective";
import { getCustomerScores } from "@/lib/customers/scoring/service";
import type { Customer } from "../../../../drizzle/schema/customers";
import { SETTING_DEFAULTS } from "@/lib/settings/keys";
import { parseEffectiveSettings } from "@/lib/settings/effective";

const FIXED_NOW = new Date("2026-08-06T04:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgoIso(days: number): string {
  return new Date(FIXED_NOW.getTime() - days * MS_PER_DAY).toISOString();
}

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  const anchor = daysAgoIso(10);
  return {
    id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
    customerCode: null,
    customerName: "Score countdown",
    nameStatus: "confirmed",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000001",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    requestedProjectCode: null,
    notes: null,
    salesStage: "negotiation",
    ownerId: "11111111-1111-1111-1111-111111111102",
    status: "active",
    releaserUserId: null,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    createdBy: "11111111-1111-1111-1111-111111111101",
    updatedBy: "11111111-1111-1111-1111-111111111101",
    lastFollowUpAt: null,
    lastValidFollowUpAt: anchor,
    nextFollowUpAt: null,
    reclamationCycleStartedAt: anchor,
    reclaimRuleGraceUntil: null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: 0,
    pinnedAt: null,
    collaborativeDissolvedAt: null,
    lifecycleStatus: null,
    lifecycleCompletedAt: null,
    lifecycleCompletedBy: null,
    lifecycleCompletionNotes: null,
    preferredName: null,
    gender: null,
    ageRange: null,
    preferredLanguage: null,
    preferredContactMethod: null,
    occupation: null,
    companyName: null,
    jobTitle: null,
    targetCountryOrRegion: null,
    primaryConcern: null,
    createdAt: anchor,
    updatedAt: anchor,
    ...overrides,
  } as Customer;
}

describe("customer scores reclamation countdown", () => {
  it("attaches countdown from shared settings without inventing a parallel algorithm", () => {
    const settings = parseEffectiveSettings({
      ...SETTING_DEFAULTS,
      automatic_reclaim_days: "45",
    });
    const scores = getCustomerScores(
      makeCustomer({
        lastValidFollowUpAt: daysAgoIso(35),
        reclamationCycleStartedAt: daysAgoIso(35),
      }),
      { hasFollowUp: true },
      settings,
      FIXED_NOW,
    );
    assert.equal(scores.reclamationCountdown?.daysRemaining, 10);
    assert.equal(scores.reclamationCountdown?.state, "warning");
    assert.equal(scores.reclamationCountdown?.reclaimDays, 45);
  });

  it("reads settings once in list pages and does not per-card fetch", () => {
    const page = readFileSync("src/app/(dashboard)/customers/page.tsx", "utf8");
    const api = readFileSync("src/app/api/customers/route.ts", "utf8");
    const client = readFileSync(
      "src/app/(dashboard)/customers/customers-list-client.tsx",
      "utf8",
    );
    const badge = readFileSync(
      "src/components/customers/reclamation-countdown-badge.tsx",
      "utf8",
    );

    assert.match(page, /getEffectiveSettings/);
    assert.match(api, /getEffectiveSettings/);
    assert.doesNotMatch(client, /getEffectiveSettings|fetch\(.*settings/i);
    assert.doesNotMatch(badge, /setInterval|requestAnimationFrame/);
    assert.equal(typeof getEffectiveSettings, "function");
  });
});
