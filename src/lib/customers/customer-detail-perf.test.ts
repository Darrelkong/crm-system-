import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  measureAsync,
  roundPerfMs,
  shouldEnableCustomerDetailPerf,
} from "@/lib/customers/customer-detail-perf";

function readDetailPageSource(): string {
  return readFileSync("src/app/(dashboard)/customers/[id]/page.tsx", "utf8");
}

function readPerfPanelSource(): string {
  return readFileSync(
    "src/app/(dashboard)/customers/[id]/customer-detail-perf-panel.tsx",
    "utf8",
  );
}

describe("customer detail Phase 2B3 perf diagnostic", () => {
  it("enables diagnostic only for admin with perf=1", () => {
    assert.equal(shouldEnableCustomerDetailPerf("admin", "1"), true);
    assert.equal(shouldEnableCustomerDetailPerf("admin", undefined), false);
    assert.equal(shouldEnableCustomerDetailPerf("admin", "0"), false);
    assert.equal(shouldEnableCustomerDetailPerf("staff", "1"), false);
    assert.equal(shouldEnableCustomerDetailPerf("staff", undefined), false);
  });

  it("page gates diagnostic panel behind enablePerf", () => {
    const source = readDetailPageSource();
    assert.match(source, /shouldEnableCustomerDetailPerf/);
    assert.match(source, /perfTimings \? <CustomerDetailPerfPanel/);
    assert.match(source, /enablePerf/);
  });

  it("does not render diagnostic panel without perf=1 activation", () => {
    const source = readDetailPageSource();
    assert.match(
      source,
      /const perfTimings: CustomerDetailPerfTimings \| null = enablePerf/,
    );
    assert.match(
      source,
      /\{perfTimings \? <CustomerDetailPerfPanel timings=\{perfTimings\} \/> : null\}/,
    );
  });

  it("staff with perf=1 cannot enable diagnostic", () => {
    assert.equal(shouldEnableCustomerDetailPerf("staff", "1"), false);
  });

  it("diagnostic panel contains timing labels only", () => {
    const panel = readPerfPanelSource();
    assert.match(panel, /Customer Detail Performance Diagnostic/);
    assert.match(panel, /Server page timing only/);
    assert.match(panel, /Server data-ready total/);
    assert.match(panel, /Auth/);
    assert.match(panel, /Customer lookup/);
    assert.match(panel, /Pending approval/);
    assert.match(panel, /Access resolution/);
    assert.match(panel, /Scoring/);
    assert.match(panel, /Secondary total/);
    assert.match(panel, /Follow-ups/);
    assert.match(panel, /Timeline/);
    assert.match(panel, /Confirm name/);
    assert.match(panel, /User labels/);
    assert.match(panel, /Assignee names/);
  });

  it("diagnostic output does not include customer or session identifiers", () => {
    const sources = [
      readPerfPanelSource(),
      readFileSync("src/lib/customers/customer-detail-perf.ts", "utf8"),
    ].join("\n");
    const forbidden = [
      "customerName",
      "customerCode",
      "customerId",
      "userId",
      "sessionId",
      "accessToken",
      "cookie",
      "stack trace",
      "stackTrace",
    ];
    for (const term of forbidden) {
      assert.doesNotMatch(sources, new RegExp(term, "i"));
    }
  });

  it("measureAsync returns result and duration", async () => {
    const { result, durationMs } = await measureAsync(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 42;
    });
    assert.equal(result, 42);
    assert.ok(durationMs >= 0);
  });

  it("roundPerfMs formats milliseconds", () => {
    assert.equal(roundPerfMs(123.456), "123.5 ms");
    assert.equal(roundPerfMs(50), "50 ms");
  });

  it("preserves permission gates before secondary parallel work", () => {
    const source = readDetailPageSource();
    const parallelIndex = source.indexOf("await Promise.all([");
    const enrichIndex = source.indexOf("enrichCustomerResponse");
    const onHoldIndex = source.indexOf("getPendingOnHoldCreateApprovalForCustomer");
    const poolGateIndex = source.indexOf("isStaffUnclaimedPublicPoolCustomer");
    assert.ok(parallelIndex > enrichIndex);
    assert.ok(parallelIndex > onHoldIndex);
    assert.ok(parallelIndex > poolGateIndex);
  });

  it("preserves B2 shared follow-up preload path", () => {
    const source = readDetailPageSource();
    assert.match(source, /sharedFollowUpsPromise/);
    assert.match(source, /preloadedFollowUps/);
    assert.match(source, /assertCanViewCustomerTimeline/);
    assert.match(source, /assertCanViewFollowUps/);
  });

  it("preserves secondary Promise.all parallelism", () => {
    const source = readDetailPageSource();
    const section = source.slice(
      source.indexOf("const secondaryStart"),
      source.indexOf("<CustomerDetailClient"),
    );
    assert.match(section, /await Promise\.all\(\[/);
    assert.doesNotMatch(
      section,
      /await measureAsync\(\(\) => canConfirm[\s\S]*await measureAsync\(\(\) => resolveCustomerUserLabels/,
    );
  });

  it("times timeline after preloaded follow-ups without double-counting", () => {
    const source = readDetailPageSource();
    assert.match(source, /sharedFollowUpsMeasurePromise/);
    assert.match(source, /followUpsMs: followUpsMeasured\.durationMs/);
    assert.match(source, /timelineMs: timelineTimed\.durationMs/);
    assert.match(
      readPerfPanelSource(),
      /Timeline duration excludes shared Follow-up load/,
    );
  });

  it("does not add production logging for timings", () => {
    const source = readDetailPageSource();
    assert.doesNotMatch(source, /console\.(info|log|debug|warn)\(/);
  });
});
