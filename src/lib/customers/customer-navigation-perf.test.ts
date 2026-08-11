import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  NAVIGATION_PERF_MARKER_KEY,
  NAVIGATION_PERF_MARKER_VERSION,
  NAVIGATION_PERF_MAX_AGE_MS,
  consumeNavigationMarker,
  deriveNavigationPerfMetrics,
  detectResourceSizeTimingSupport,
  formatBytes,
  isNavigationMarkerStale,
  markerContainsOnlyAllowedFields,
  maxResourceField,
  parseNavigationMarker,
  routeZeroTransferEvidence,
  shouldEnableCustomerNavigationPerf,
  sumResourceField,
  writeNavigationMarker,
  type NavigationPerfMarker,
  type ResourceTimingLike,
} from "@/lib/customers/customer-navigation-perf";

function readCustomersPageSource(): string {
  return readFileSync("src/app/(dashboard)/customers/page.tsx", "utf8");
}

function readCustomersListClientSource(): string {
  return readFileSync(
    "src/app/(dashboard)/customers/customers-list-client.tsx",
    "utf8",
  );
}

function readNavigationPerfProbeSource(): string {
  return readFileSync(
    "src/app/(dashboard)/customers/[id]/customer-navigation-perf-probe.tsx",
    "utf8",
  );
}

function readCustomerDetailClientSource(): string {
  return readFileSync(
    "src/app/(dashboard)/customers/[id]/customer-detail-client.tsx",
    "utf8",
  );
}

function readNavigationPerfPanelSource(): string {
  return readFileSync(
    "src/app/(dashboard)/customers/[id]/customer-navigation-perf-panel.tsx",
    "utf8",
  );
}

const marker: NavigationPerfMarker = {
  version: NAVIGATION_PERF_MARKER_VERSION,
  source: "customer-list",
  pointerDownEpochMs: 1000,
  clickEpochMs: 1050,
  createdAtEpochMs: 1000,
};

describe("customer navigation Phase 2B4 diagnostic", () => {
  it("enables navigation diagnostics only for admin with perf=1", () => {
    assert.equal(shouldEnableCustomerNavigationPerf("admin", "1"), true);
    assert.equal(shouldEnableCustomerNavigationPerf("admin", undefined), false);
    assert.equal(shouldEnableCustomerNavigationPerf("staff", "1"), false);
  });

  it("customers page gates navigation perf from server role and perf param", () => {
    const source = readCustomersPageSource();
    assert.match(source, /shouldEnableCustomerNavigationPerf/);
    assert.match(source, /enableNavigationPerf=\{enableNavigationPerf\}/);
    assert.match(source, /params\.perf/);
  });

  it("does not enable navigation diagnostics without perf=1", () => {
    const source = readCustomersListClientSource();
    assert.match(source, /enableNavigationPerf = false/);
    assert.match(
      source,
      /const navigationPerfHandlers = enableNavigationPerf/,
    );
  });

  it("staff with perf=1 cannot enable navigation diagnostics", () => {
    assert.equal(shouldEnableCustomerNavigationPerf("staff", "1"), false);
  });

  it("keeps customer detail href unchanged and without perf query", () => {
    const source = readCustomersListClientSource();
    assert.match(source, /href=\{`\/customers\/\$\{c\.id\}`\}/g);
    assert.doesNotMatch(source, /\/customers\/\$\{c\.id\}\?perf=1/);
    assert.doesNotMatch(source, /navPerf=1/);
  });

  it("instruments desktop and mobile links only in diagnostic mode", () => {
    const source = readCustomersListClientSource();
    assert.match(source, /recordNavigationPointerDownMark/);
    assert.match(source, /recordNavigationClickMark/);
    assert.match(source, /\{\.\.\.navigationPerfHandlers\}/);
  });

  it("gates CustomerNavigationPerfProbe to admin via isAdmin", () => {
    const detailClient = readCustomerDetailClientSource();
    const probe = readNavigationPerfProbeSource();
    assert.match(detailClient, /<CustomerNavigationPerfProbe enabled=\{isAdmin\} \/>/);
    assert.match(probe, /enabled: boolean/);
    assert.match(probe, /if \(!enabled\)/);
  });

  it("disabled probe does not consume navigation marker", () => {
    const probe = readNavigationPerfProbeSource();
    const effectBody = probe.slice(probe.indexOf("useLayoutEffect(() => {"));
    const enabledGuardIndex = effectBody.indexOf("if (!enabled)");
    const consumeIndex = effectBody.indexOf("consumeNavigationMarker");
    assert.ok(enabledGuardIndex >= 0);
    assert.ok(consumeIndex > enabledGuardIndex);
  });

  it("stores only allowed timing metadata in navigation marker", () => {
    const raw = JSON.stringify(marker);
    assert.equal(markerContainsOnlyAllowedFields(raw), true);
    const forbidden = [
      "customerId",
      "customerName",
      "customerCode",
      "userId",
      "pathname",
      "url",
      "email",
      "phone",
      "session",
      "cookie",
    ];
    for (const term of forbidden) {
      assert.doesNotMatch(raw, new RegExp(term, "i"));
    }
  });

  it("rejects stale navigation markers", () => {
    assert.equal(
      isNavigationMarkerStale(marker, marker.createdAtEpochMs + NAVIGATION_PERF_MAX_AGE_MS + 1),
      true,
    );
    assert.equal(
      isNavigationMarkerStale(marker, marker.createdAtEpochMs + 1000),
      false,
    );
  });

  it("consumes and removes fresh navigation markers", () => {
    const storage = new Map<string, string>();
    const original = globalThis.sessionStorage;
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
      },
    });

    try {
      writeNavigationMarker(marker);
      const consumed = consumeNavigationMarker(marker.createdAtEpochMs + 500);
      assert.deepEqual(consumed, marker);
      assert.equal(storage.has(NAVIGATION_PERF_MARKER_KEY), false);
      assert.equal(
        consumeNavigationMarker(marker.createdAtEpochMs + 500),
        null,
      );
    } finally {
      Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        value: original,
      });
    }
  });

  it("derives post-click matching route fetch metrics", () => {
    const clickEpochMs = 2000;
    const commitEpochMs = 2600;
    const timeOrigin = 1000;
    const resources: ResourceTimingLike[] = [
      {
        name: "https://example.com/customers/abc",
        initiatorType: "fetch",
        startTime: 950,
        requestStart: 1000,
        responseStart: 1200,
        responseEnd: 1500,
      },
    ];

    const metrics = deriveNavigationPerfMetrics(
      { ...marker, clickEpochMs, createdAtEpochMs: clickEpochMs - 50 },
      commitEpochMs,
      "/customers/abc",
      resources,
      timeOrigin,
      "https://example.com",
    );

    assert.equal(metrics.routeResourceState, "after-click");
    assert.equal(metrics.clickToRouteRequestStartMs, 0);
    assert.equal(metrics.routeRequestWaitMs, 200);
    assert.equal(metrics.routeResponseTransferMs, 300);
    assert.equal(metrics.clickToRouteResponseEndMs, 500);
    assert.equal(metrics.routeResponseEndToCommitMs, 100);
  });

  it("derives pre-click matching route fetch metrics", () => {
    const clickEpochMs = 3000;
    const commitEpochMs = 3400;
    const timeOrigin = 1000;
    const resources: ResourceTimingLike[] = [
      {
        name: "https://example.com/customers/abc",
        initiatorType: "fetch",
        startTime: 1400,
        requestStart: 1500,
        responseStart: 1700,
        responseEnd: 1900,
      },
    ];

    const metrics = deriveNavigationPerfMetrics(
      { ...marker, clickEpochMs, createdAtEpochMs: clickEpochMs - 50 },
      commitEpochMs,
      "/customers/abc",
      resources,
      timeOrigin,
      "https://example.com",
    );

    assert.equal(metrics.routeResourceState, "before-click");
    assert.equal(metrics.routeBeforeClickMs, 100);
  });

  it("reports no matching route fetch when none exists", () => {
    const metrics = deriveNavigationPerfMetrics(
      marker,
      2000,
      "/customers/abc",
      [
        {
          name: "https://example.com/other",
          initiatorType: "fetch",
          startTime: 100,
          requestStart: 100,
          responseStart: 200,
          responseEnd: 300,
        },
      ],
      1000,
      "https://example.com",
    );

    assert.equal(metrics.routeResourceState, "not-observed");
    assert.equal(metrics.clickToRouteRequestStartMs, null);
  });

  it("derives post-click script aggregate metrics", () => {
    const clickEpochMs = 2000;
    const timeOrigin = 1000;
    const resources: ResourceTimingLike[] = [
      {
        name: "https://example.com/_next/static/chunks/a.js",
        initiatorType: "script",
        startTime: 1050,
        responseEnd: 1200,
      },
      {
        name: "https://example.com/_next/static/chunks/b.js",
        initiatorType: "script",
        startTime: 1100,
        responseEnd: 1400,
      },
      {
        name: "https://example.com/_next/static/chunks/old.js",
        initiatorType: "script",
        startTime: 500,
        responseEnd: 700,
      },
    ];

    const metrics = deriveNavigationPerfMetrics(
      { ...marker, clickEpochMs },
      2500,
      "/customers/abc",
      resources,
      timeOrigin,
      "https://example.com",
    );

    assert.equal(metrics.postClickScriptCount, 2);
    assert.equal(metrics.clickToLastScriptResponseEndMs, 400);
  });

  it("reports zero post-click scripts when none started after click", () => {
    const metrics = deriveNavigationPerfMetrics(
      { ...marker, clickEpochMs: 3000 },
      3400,
      "/customers/abc",
      [
        {
          name: "https://example.com/_next/static/chunks/old.js",
          initiatorType: "script",
          startTime: 100,
          responseEnd: 200,
        },
      ],
      1000,
      "https://example.com",
    );

    assert.equal(metrics.postClickScriptCount, 0);
    assert.equal(metrics.clickToLastScriptResponseEndMs, null);
  });

  it("parses valid navigation markers", () => {
    const parsed = parseNavigationMarker(JSON.stringify(marker));
    assert.deepEqual(parsed, marker);
  });

  it("maps extended PerformanceResourceTiming fields in probe", () => {
    const probe = readNavigationPerfProbeSource();
    assert.match(probe, /transferSize: entry\.transferSize/);
    assert.match(probe, /encodedBodySize: entry\.encodedBodySize/);
    assert.match(probe, /decodedBodySize: entry\.decodedBodySize/);
    assert.match(probe, /nextHopProtocol: entry\.nextHopProtocol/);
  });

  it("derives route size and protocol metrics", () => {
    const clickEpochMs = 2000;
    const metrics = deriveNavigationPerfMetrics(
      { ...marker, clickEpochMs },
      2600,
      "/customers/abc",
      [
        {
          name: "https://example.com/customers/abc",
          initiatorType: "fetch",
          startTime: 950,
          requestStart: 1000,
          responseStart: 1200,
          responseEnd: 1500,
          transferSize: 100_000,
          encodedBodySize: 90_000,
          decodedBodySize: 250_000,
          nextHopProtocol: "h2",
        },
      ],
      1000,
      "https://example.com",
    );

    assert.equal(metrics.routeTransferSize, 100_000);
    assert.equal(metrics.routeEncodedBodySize, 90_000);
    assert.equal(metrics.routeDecodedBodySize, 250_000);
    assert.equal(metrics.routeProtocol, "h2");
    assert.equal(formatBytes(metrics.routeTransferSize), "97.7 KiB");
    assert.equal(metrics.resourceSizeTimingSupport, "YES");
  });

  it("reports route zero-transfer evidence observational states", () => {
    assert.equal(routeZeroTransferEvidence(0, 250_000), "YES");
    assert.equal(routeZeroTransferEvidence(100_000, 250_000), "NO");
    assert.equal(routeZeroTransferEvidence(undefined, 250_000), "N/A");
  });

  it("aggregates post-click script size metrics only", () => {
    const clickEpochMs = 2000;
    const resources: ResourceTimingLike[] = [
      {
        name: "https://example.com/_next/static/chunks/a.js",
        initiatorType: "script",
        startTime: 1050,
        responseEnd: 1200,
        transferSize: 40_000,
        encodedBodySize: 35_000,
        decodedBodySize: 120_000,
      },
      {
        name: "https://example.com/_next/static/chunks/b.js",
        initiatorType: "script",
        startTime: 1100,
        responseEnd: 1400,
        transferSize: 0,
        encodedBodySize: 0,
        decodedBodySize: 80_000,
      },
      {
        name: "https://example.com/_next/static/chunks/old.js",
        initiatorType: "script",
        startTime: 500,
        responseEnd: 700,
        transferSize: 10_000,
        encodedBodySize: 9_000,
        decodedBodySize: 20_000,
      },
      {
        name: "https://example.com/customers/abc",
        initiatorType: "fetch",
        startTime: 1000,
        requestStart: 1000,
        responseStart: 1200,
        responseEnd: 1500,
        transferSize: 100_000,
        encodedBodySize: 90_000,
        decodedBodySize: 250_000,
      },
    ];

    const metrics = deriveNavigationPerfMetrics(
      { ...marker, clickEpochMs },
      2500,
      "/customers/abc",
      resources,
      1000,
      "https://example.com",
    );

    assert.equal(metrics.postClickScriptCount, 2);
    assert.equal(metrics.postClickScriptTransferTotal, 40_000);
    assert.equal(metrics.postClickScriptEncodedTotal, 35_000);
    assert.equal(metrics.postClickScriptDecodedTotal, 200_000);
    assert.equal(metrics.largestPostClickScriptTransfer, 40_000);
    assert.equal(metrics.largestPostClickScriptEncoded, 35_000);
    assert.equal(metrics.postClickScriptsWithZeroTransfer, 1);
    assert.equal(metrics.routeZeroTransferEvidence, "NO");
  });

  it("sums and maxes resource fields deterministically", () => {
    const resources: ResourceTimingLike[] = [
      { name: "a", initiatorType: "script", startTime: 1, transferSize: 10 },
      { name: "b", initiatorType: "script", startTime: 2, transferSize: 30 },
    ];
    assert.equal(sumResourceField(resources, "transferSize"), 40);
    assert.equal(maxResourceField(resources, "transferSize"), 30);
  });

  it("detects resource size timing support states", () => {
    const fullRoute: ResourceTimingLike = {
      name: "route",
      initiatorType: "fetch",
      startTime: 1,
      transferSize: 1,
      encodedBodySize: 1,
      decodedBodySize: 1,
    };
    const partialScript: ResourceTimingLike = {
      name: "script",
      initiatorType: "script",
      startTime: 2,
      transferSize: 1,
    };
    assert.equal(detectResourceSizeTimingSupport(fullRoute, []), "YES");
    assert.equal(
      detectResourceSizeTimingSupport(fullRoute, [partialScript]),
      "PARTIAL",
    );
    assert.equal(detectResourceSizeTimingSupport(null, []), "NO");
  });

  it("panel output does not expose resource URLs or identifiers", () => {
    const panel = readNavigationPerfPanelSource();
    const helper = readFileSync(
      "src/lib/customers/customer-navigation-perf.ts",
      "utf8",
    );
    const forbidden = [
      "customerId",
      "customerName",
      "customerCode",
      "userId",
      "sessionId",
      "https://",
      ".js",
      "pathname",
      "userAgent",
    ];
    for (const term of forbidden) {
      assert.doesNotMatch(panel, new RegExp(term, "i"));
    }
    assert.doesNotMatch(helper, /console\.(info|log|debug|warn)\(/);
    assert.match(panel, /Resource sizes come from browser PerformanceResourceTiming/);
  });
});
