"use client";

import { useLayoutEffect, useState } from "react";
import {
  consumeNavigationMarker,
  deriveNavigationPerfMetrics,
  epochNow,
  type NavigationPerfMetrics,
  type ResourceTimingLike,
} from "@/lib/customers/customer-navigation-perf";
import { CustomerNavigationPerfPanel } from "./customer-navigation-perf-panel";

export function CustomerNavigationPerfProbe() {
  const [metrics, setMetrics] = useState<NavigationPerfMetrics | null>(null);

  useLayoutEffect(() => {
    const commitEpochMs = epochNow();
    const marker = consumeNavigationMarker(commitEpochMs);
    if (!marker) {
      return;
    }

    const detailPathname = window.location.pathname;
    const timeOrigin = performance.timeOrigin;
    const resources = performance.getEntriesByType(
      "resource",
    ) as PerformanceResourceTiming[];

    const resourceLike: ResourceTimingLike[] = resources.map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      startTime: entry.startTime,
      requestStart: entry.requestStart,
      responseStart: entry.responseStart,
      responseEnd: entry.responseEnd,
    }));

    const base = deriveNavigationPerfMetrics(
      marker,
      commitEpochMs,
      detailPathname,
      resourceLike,
      timeOrigin,
      window.location.origin,
    );

    requestAnimationFrame(() => {
      const nextFrameEpochMs = epochNow();
      requestAnimationFrame(() => {
        const secondFrameEpochMs = epochNow();
        setMetrics({
          ...base,
          commitToNextFrameMs: nextFrameEpochMs - commitEpochMs,
          commitToSecondFrameMs: secondFrameEpochMs - commitEpochMs,
        });
      });
    });
  }, []);

  if (!metrics) {
    return null;
  }

  return <CustomerNavigationPerfPanel metrics={metrics} />;
}
