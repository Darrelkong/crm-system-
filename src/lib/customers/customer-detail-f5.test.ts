import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function readSessionSource(): string {
  return readFileSync("src/lib/auth/session.ts", "utf8");
}

function readDetailPageSource(): string {
  return readFileSync("src/app/(dashboard)/customers/[id]/page.tsx", "utf8");
}

function readTimelineSource(): string {
  return readFileSync("src/lib/customers/timeline/service.ts", "utf8");
}

function readUserLabelsSource(): string {
  return readFileSync("src/lib/customers/user-labels.ts", "utf8");
}

function readScoringSource(): string {
  return readFileSync("src/lib/customers/scoring/service.ts", "utf8");
}

describe("F5 auth session/policy parallel reads", () => {
  it("starts session/user lookup and global idle policy together", () => {
    const source = readSessionSource();
    const block = source.slice(
      source.indexOf("const sessionQuery = db"),
      source.indexOf("const row = rows[0]"),
    );
    assert.match(block, /const policyQuery = getGlobalIdlePolicy\(db\)/);
    assert.match(block, /await Promise\.all\(\[/);
    assert.match(block, /sessionQuery/);
    assert.match(block, /policyQuery/);
  });

  it("keeps device, idle, revocation, and touch checks after row resolution", () => {
    const source = readSessionSource();
    const afterRow = source.slice(source.indexOf("const row = rows[0]"));
    const deviceIndex = afterRow.indexOf("isDeviceAllowedForStaffSession");
    const revokedIndex = afterRow.indexOf("isSessionRevoked(row.session)");
    const idleIndex = afterRow.indexOf("isSessionIdleExpired");
    const touchIndex = afterRow.indexOf("touchSessionActivity");
    assert.ok(deviceIndex >= 0);
    assert.ok(revokedIndex > deviceIndex);
    assert.ok(idleIndex > revokedIndex);
    assert.ok(touchIndex > idleIndex);
  });

  it("records auth sub-timings without exposing sensitive metadata", () => {
    const source = readSessionSource();
    assert.match(source, /recordAuthValidationPerf/);
    assert.match(source, /authSessionReadMs/);
    assert.match(source, /authPolicyReadMs/);
    const perfSource = readFileSync("src/lib/auth/validation-perf.ts", "utf8");
    assert.doesNotMatch(perfSource, /deviceIdHash/);
    assert.doesNotMatch(perfSource, /sessionId/);
    assert.doesNotMatch(perfSource, /tokenHash/);
  });
});

describe("F5 timeline actor-name and follow-up parallelism", () => {
  it("loads actor names in the first Promise.all stage", () => {
    const source = readTimelineSource();
    const stageOneStart = source.indexOf("await Promise.all([");
    const stageOneEnd = source.indexOf("const resolvedFollowUps", stageOneStart);
    const stageOne = source.slice(stageOneStart, stageOneEnd);
    assert.match(stageOne, /loadActorNamesForCustomer/);
    assert.doesNotMatch(stageOne, /const actorIds/);
    assert.doesNotMatch(source.slice(stageOneEnd), /await loadActorNames\(/);
  });

  it("bounds actor-name lookup to customer-related user IDs", () => {
    const source = readTimelineSource();
    assert.match(source, /loadActorNamesForCustomer/);
    assert.match(source, /WHERE t\.customer_id = \$\{customerId\}/);
    assert.match(source, /schema\.users\.id} IN/);
  });

  it("supports shared follow-ups promise without duplicate query on page", () => {
    const page = readDetailPageSource();
    const timelineBlock = page.slice(
      page.indexOf("const timelineFollowUpsPromise"),
      page.indexOf("const timelinePromise"),
    );
    assert.match(timelineBlock, /followUpsChainPromise/);
    assert.match(page, /followUpsPromise: timelineFollowUpsPromise/);
    assert.doesNotMatch(
      page.slice(page.indexOf("const timelinePromise")),
      /await followUpsChainPromise/,
    );
  });
});

describe("F5 admin display names single network wait", () => {
  it("admin path uses parallel bounded display-name resolver", () => {
    const page = readDetailPageSource();
    assert.match(page, /resolveAdminCustomerDetailDisplayNames/);
    assert.doesNotMatch(
      page,
      /measureAsync\(async \(\) => \{\s*const assignees = await listCustomerAssignees/,
    );
  });

  it("staff path still reuses preloaded assignees", () => {
    const page = readDetailPageSource();
    assert.match(
      page,
      /resolveCustomerDetailDisplayNames\(db, customer, preloadedAssignees!/,
    );
  });

  it("admin resolver uses Promise.all for assignees and owner/creator", () => {
    const source = readUserLabelsSource();
    const fn = source.slice(
      source.indexOf("export async function resolveAdminCustomerDetailDisplayNames"),
      source.indexOf("export async function resolveCustomerAssigneeNames("),
    );
    assert.match(fn, /await Promise\.all\(\[/);
    assert.match(fn, /schema\.customerAssignees/);
    assert.match(fn, /schema\.users/);
  });
});

describe("F5 scoring settings parallel preload", () => {
  it("starts effective settings before follow-up chain completes", () => {
    const page = readDetailPageSource();
    const settingsIndex = page.indexOf("effectiveSettingsPromise");
    const followUpsIndex = page.indexOf("const followUpsChainPromise");
    const scoringIndex = page.indexOf("const scoringPromise");
    assert.ok(settingsIndex >= 0);
    assert.ok(settingsIndex < followUpsIndex || settingsIndex < scoringIndex);
    assert.match(page, /preloadedSettings: settings/);
  });

  it("enrichCustomerResponse skips settings query when preloaded", () => {
    const source = readScoringSource();
    assert.match(source, /preloadedSettings\?: EffectiveSettings/);
    assert.match(
      source,
      /enrichOptions\?\.preloadedSettings \?\? \(await getEffectiveSettings\(db\)\)/,
    );
  });
});
