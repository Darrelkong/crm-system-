import {
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
          label="Post-click script requests"
          value={String(metrics.postClickScriptCount)}
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
