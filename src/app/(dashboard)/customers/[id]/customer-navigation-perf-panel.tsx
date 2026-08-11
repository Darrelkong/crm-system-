import {
  formatBytes,
  formatNavigationPerfValue,
  type NavigationPerfMetrics,
} from "@/lib/customers/customer-navigation-perf";

type Props = {
  metrics: NavigationPerfMetrics;
};

function routeResourceLabel(state: NavigationPerfMetrics["routeResourceState"]): string {
  switch (state) {
    case "after-click":
      return "after-click";
    case "before-click":
      return "before-click";
    default:
      return "not observed";
  }
}

export function CustomerNavigationPerfPanel({ metrics }: Props) {
  return (
    <section
      className="mt-8 rounded-lg border border-sky-300 bg-sky-50 p-4 text-xs text-sky-950"
      aria-label="Customer navigation performance diagnostic"
    >
      <h2 className="mb-1 font-semibold">
        Customer Navigation Performance Diagnostic
      </h2>
      <p className="mb-3 text-[11px] text-sky-800">
        Client navigation timing only. Click → client commit is measured at the
        earliest Customer Detail client commit boundary, not browser paint.
      </p>
      <dl className="grid gap-1 font-mono">
        <Row label="Tap/pointer → click" value={formatNavigationPerfValue(metrics.pointerToClickMs)} />
        <Row label="Click → client commit" value={formatNavigationPerfValue(metrics.clickToCommitMs)} />
        <Row
          label="Route resource"
          value={routeResourceLabel(metrics.routeResourceState)}
        />
        {metrics.routeResourceState === "before-click" && (
          <Row
            label="Route resource before click"
            value="YES"
          />
        )}
        {metrics.routeBeforeClickMs != null && (
          <Row
            label="Completed before click"
            value={formatNavigationPerfValue(metrics.routeBeforeClickMs)}
          />
        )}
        <Row
          label="Click → route request start"
          value={formatNavigationPerfValue(metrics.clickToRouteRequestStartMs)}
        />
        <Row
          label="Route request wait (TTFB-like)"
          value={formatNavigationPerfValue(metrics.routeRequestWaitMs)}
        />
        <Row
          label="Route response transfer"
          value={formatNavigationPerfValue(metrics.routeResponseTransferMs)}
        />
        <Row
          label="Click → route response end"
          value={formatNavigationPerfValue(metrics.clickToRouteResponseEndMs)}
        />
        <Row
          label="Route response end → client commit"
          value={formatNavigationPerfValue(metrics.routeResponseEndToCommitMs)}
        />
        <Row
          label="Resource size timing supported"
          value={metrics.resourceSizeTimingSupport}
        />
        <Row
          label="Route transfer size"
          value={formatBytes(metrics.routeTransferSize)}
        />
        <Row
          label="Route encoded body size"
          value={formatBytes(metrics.routeEncodedBodySize)}
        />
        <Row
          label="Route decoded body size"
          value={formatBytes(metrics.routeDecodedBodySize)}
        />
        <Row
          label="Route protocol"
          value={metrics.routeProtocol ?? "N/A"}
        />
        <Row
          label="Route zero-transfer evidence"
          value={metrics.routeZeroTransferEvidence}
        />
        <Row
          label="Post-click script requests"
          value={String(metrics.postClickScriptCount)}
        />
        <Row
          label="Post-click script transfer total"
          value={formatBytes(metrics.postClickScriptTransferTotal)}
        />
        <Row
          label="Post-click script encoded total"
          value={formatBytes(metrics.postClickScriptEncodedTotal)}
        />
        <Row
          label="Post-click script decoded total"
          value={formatBytes(metrics.postClickScriptDecodedTotal)}
        />
        <Row
          label="Largest post-click script transfer"
          value={formatBytes(metrics.largestPostClickScriptTransfer)}
        />
        <Row
          label="Largest post-click script encoded"
          value={formatBytes(metrics.largestPostClickScriptEncoded)}
        />
        <Row
          label="Post-click scripts with zero transfer"
          value={String(metrics.postClickScriptsWithZeroTransfer)}
        />
        <Row
          label="Click → last script response end"
          value={formatNavigationPerfValue(metrics.clickToLastScriptResponseEndMs)}
        />
        <Row
          label="Client commit → next frame"
          value={formatNavigationPerfValue(metrics.commitToNextFrameMs)}
        />
        <Row
          label="Client commit → second frame"
          value={formatNavigationPerfValue(metrics.commitToSecondFrameMs)}
        />
      </dl>
      <p className="mt-3 text-[11px] text-sky-800">
        Resource sizes come from browser PerformanceResourceTiming. Zero
        transferSize may indicate a cached/local response but does not prove a
        specific cache mechanism.
      </p>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
