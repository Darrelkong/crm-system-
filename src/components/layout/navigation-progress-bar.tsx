"use client";

import { useIsNavigationPending } from "@/components/layout/navigation-pending";

export function NavigationProgressBar() {
  const isPending = useIsNavigationPending();

  if (!isPending) {
    return null;
  }

  return (
    <div
      className="nav-progress-track"
      role="progressbar"
      aria-label="Loading page"
      aria-busy="true"
    >
      <div className="nav-progress-bar" />
    </div>
  );
}
