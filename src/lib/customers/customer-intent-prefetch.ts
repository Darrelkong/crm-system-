export const CUSTOMER_INTENT_DESKTOP_PREFETCH_MAX = 2;
export const CUSTOMER_INTENT_MOBILE_PREFETCH_MAX = 5;
export const CUSTOMER_INTENT_PREFETCH_COOLDOWN_MS = 3000;
export const CUSTOMER_INTENT_DESKTOP_DWELL_MS = 200;
export const CUSTOMER_INTENT_MOBILE_STABLE_WINDOW_MS = 600;
export const CUSTOMER_INTENT_MOBILE_MAX_CANDIDATES = 5;
export const CUSTOMER_INTENT_MOBILE_MIN_RATIO = 0.5;

/** @deprecated B6 single-candidate dwell; retained for test migration only */
export const CUSTOMER_INTENT_MOBILE_DWELL_MS =
  CUSTOMER_INTENT_MOBILE_STABLE_WINDOW_MS;

/** @deprecated B6 central band; B6.1 uses full viewport + center sort */
export const CUSTOMER_INTENT_MOBILE_ROOT_MARGIN = "0px";

export function customerDetailHref(customerId: string): string {
  return `/customers/${customerId}`;
}

export type CustomerIntentPrefetchTimerId = number;

export type CustomerIntentPrefetchDeps = {
  prefetch: (href: string) => void;
  now: () => number;
  setTimeout: (
    fn: () => void,
    ms: number,
  ) => CustomerIntentPrefetchTimerId;
  clearTimeout: (id: CustomerIntentPrefetchTimerId) => void;
  isListBlocked: () => boolean;
  isDocumentHidden: () => boolean;
  isOffline: () => boolean;
  hasSaveData: () => boolean;
};

export type VisibleCustomerCandidate = {
  href: string;
  centerY: number;
};

export function isCoarsePointerEnvironment(
  matchMedia: (query: string) => MediaQueryList,
): boolean {
  return matchMedia("(hover: none) and (pointer: coarse)").matches;
}

export function isMobileViewportProminent(
  entry: Pick<IntersectionObserverEntry, "isIntersecting" | "intersectionRatio">,
): boolean {
  return (
    entry.isIntersecting &&
    entry.intersectionRatio >= CUSTOMER_INTENT_MOBILE_MIN_RATIO
  );
}

export function visibleCandidateFromEntry(
  href: string,
  entry: Pick<
    IntersectionObserverEntry,
    "isIntersecting" | "intersectionRatio" | "boundingClientRect"
  >,
): VisibleCustomerCandidate | null {
  if (!isMobileViewportProminent(entry)) {
    return null;
  }
  const { top, height } = entry.boundingClientRect;
  return {
    href,
    centerY: top + height / 2,
  };
}

export function sortVisibleCandidatesByCenterPriority(
  candidates: VisibleCustomerCandidate[],
  viewportCenterY: number,
): VisibleCustomerCandidate[] {
  return [...candidates].sort((a, b) => {
    const distanceA = Math.abs(a.centerY - viewportCenterY);
    const distanceB = Math.abs(b.centerY - viewportCenterY);
    if (distanceA !== distanceB) {
      return distanceA - distanceB;
    }
    return a.href.localeCompare(b.href);
  });
}

export function takeTopVisibleCandidates(
  candidates: VisibleCustomerCandidate[],
  viewportCenterY: number,
  max = CUSTOMER_INTENT_MOBILE_MAX_CANDIDATES,
): string[] {
  return sortVisibleCandidatesByCenterPriority(candidates, viewportCenterY)
    .slice(0, max)
    .map((candidate) => candidate.href);
}

export class CustomerIntentPrefetchController {
  private readonly prefetchedHrefs = new Set<string>();
  private desktopPrefetchCount = 0;
  private mobilePrefetchCount = 0;
  private lastPrefetchAt = -Infinity;
  private desktopTimer: CustomerIntentPrefetchTimerId | null = null;
  private stableWindowTimer: CustomerIntentPrefetchTimerId | null = null;
  private queueTimer: CustomerIntentPrefetchTimerId | null = null;
  private readonly visibleCandidates = new Map<string, number>();
  private mobileQueue: string[] = [];
  private mobileQueueIndex = 0;
  private viewportCenterY = 0;

  constructor(private readonly deps: CustomerIntentPrefetchDeps) {}

  getPrefetchedCount(): number {
    return this.prefetchedHrefs.size;
  }

  getDesktopPrefetchCount(): number {
    return this.desktopPrefetchCount;
  }

  getMobilePrefetchCount(): number {
    return this.mobilePrefetchCount;
  }

  hasPrefetched(href: string): boolean {
    return this.prefetchedHrefs.has(href);
  }

  getMobileQueueSnapshot(): readonly string[] {
    return this.mobileQueue;
  }

  getVisibleCandidateCount(): number {
    return this.visibleCandidates.size;
  }

  private passesSharedPrefetchGates(at = this.deps.now()): boolean {
    if (this.deps.isListBlocked()) {
      return false;
    }
    if (this.deps.isDocumentHidden()) {
      return false;
    }
    if (this.deps.isOffline()) {
      return false;
    }
    if (this.deps.hasSaveData()) {
      return false;
    }
    if (at - this.lastPrefetchAt < CUSTOMER_INTENT_PREFETCH_COOLDOWN_MS) {
      return false;
    }
    return true;
  }

  canDesktopPrefetch(href: string, at = this.deps.now()): boolean {
    if (this.desktopPrefetchCount >= CUSTOMER_INTENT_DESKTOP_PREFETCH_MAX) {
      return false;
    }
    if (this.prefetchedHrefs.has(href)) {
      return false;
    }
    return this.passesSharedPrefetchGates(at);
  }

  canMobilePrefetch(href: string, at = this.deps.now()): boolean {
    if (this.mobilePrefetchCount >= CUSTOMER_INTENT_MOBILE_PREFETCH_MAX) {
      return false;
    }
    if (this.prefetchedHrefs.has(href)) {
      return false;
    }
    return this.passesSharedPrefetchGates(at);
  }

  private controlledDesktopPrefetch(
    href: string,
    at = this.deps.now(),
  ): boolean {
    if (!this.canDesktopPrefetch(href, at)) {
      return false;
    }
    this.deps.prefetch(href);
    this.prefetchedHrefs.add(href);
    this.desktopPrefetchCount += 1;
    this.lastPrefetchAt = at;
    return true;
  }

  private controlledMobilePrefetch(href: string, at = this.deps.now()): boolean {
    if (!this.canMobilePrefetch(href, at)) {
      return false;
    }
    this.deps.prefetch(href);
    this.prefetchedHrefs.add(href);
    this.mobilePrefetchCount += 1;
    this.lastPrefetchAt = at;
    return true;
  }

  scheduleDesktopDwell(href: string): void {
    this.cancelDesktopDwell();
    this.desktopTimer = this.deps.setTimeout(() => {
      this.desktopTimer = null;
      this.controlledDesktopPrefetch(href);
    }, CUSTOMER_INTENT_DESKTOP_DWELL_MS);
  }

  cancelDesktopDwell(): void {
    if (this.desktopTimer !== null) {
      this.deps.clearTimeout(this.desktopTimer);
      this.desktopTimer = null;
    }
  }

  updateMobileCardVisibility(
    href: string,
    entry: Pick<
      IntersectionObserverEntry,
      "isIntersecting" | "intersectionRatio" | "boundingClientRect"
    >,
    viewportCenterY: number,
  ): void {
    this.viewportCenterY = viewportCenterY;
    const candidate = visibleCandidateFromEntry(href, entry);
    const previousCenterY = this.visibleCandidates.get(href);

    if (candidate) {
      if (previousCenterY === candidate.centerY) {
        return;
      }
      this.visibleCandidates.set(href, candidate.centerY);
    } else if (previousCenterY !== undefined) {
      this.visibleCandidates.delete(href);
    } else {
      return;
    }

    this.onMobileVisibleSetChanged();
  }

  removeMobileCard(href: string): void {
    if (!this.visibleCandidates.delete(href)) {
      return;
    }
    this.onMobileVisibleSetChanged();
  }

  cancelMobilePrefetching(): void {
    this.cancelStableWindowTimer();
    this.cancelMobileQueue();
  }

  private onMobileVisibleSetChanged(): void {
    this.cancelMobileQueue();
    this.scheduleStableWindow();
  }

  private scheduleStableWindow(): void {
    this.cancelStableWindowTimer();
    if (this.deps.isListBlocked()) {
      return;
    }
    this.stableWindowTimer = this.deps.setTimeout(() => {
      this.stableWindowTimer = null;
      this.beginMobileQueueFromVisible();
    }, CUSTOMER_INTENT_MOBILE_STABLE_WINDOW_MS);
  }

  private beginMobileQueueFromVisible(): void {
    if (this.deps.isListBlocked()) {
      return;
    }

    const prioritized = takeTopVisibleCandidates(
      [...this.visibleCandidates.entries()].map(([href, centerY]) => ({
        href,
        centerY,
      })),
      this.viewportCenterY,
    ).filter((href) => !this.prefetchedHrefs.has(href));

    this.mobileQueue = prioritized;
    this.mobileQueueIndex = 0;
    this.processMobileQueue();
  }

  private processMobileQueue(): void {
    this.cancelMobileQueueTimer();

    while (this.mobileQueueIndex < this.mobileQueue.length) {
      const href = this.mobileQueue[this.mobileQueueIndex];
      const at = this.deps.now();
      const cooldownRemaining =
        CUSTOMER_INTENT_PREFETCH_COOLDOWN_MS -
        (at - this.lastPrefetchAt);

      if (this.prefetchedHrefs.has(href)) {
        this.mobileQueueIndex += 1;
        continue;
      }

      if (cooldownRemaining > 0) {
        this.queueTimer = this.deps.setTimeout(
          () => this.processMobileQueue(),
          cooldownRemaining,
        );
        return;
      }

      if (!this.canMobilePrefetch(href, at)) {
        return;
      }

      this.controlledMobilePrefetch(href, at);
      this.mobileQueueIndex += 1;

      if (this.mobileQueueIndex < this.mobileQueue.length) {
        this.queueTimer = this.deps.setTimeout(
          () => this.processMobileQueue(),
          CUSTOMER_INTENT_PREFETCH_COOLDOWN_MS,
        );
      }
      return;
    }
  }

  private cancelStableWindowTimer(): void {
    if (this.stableWindowTimer !== null) {
      this.deps.clearTimeout(this.stableWindowTimer);
      this.stableWindowTimer = null;
    }
  }

  private cancelMobileQueueTimer(): void {
    if (this.queueTimer !== null) {
      this.deps.clearTimeout(this.queueTimer);
      this.queueTimer = null;
    }
  }

  private cancelMobileQueue(): void {
    this.cancelMobileQueueTimer();
    this.mobileQueue = [];
    this.mobileQueueIndex = 0;
  }

  dispose(): void {
    this.cancelDesktopDwell();
    this.cancelMobilePrefetching();
    this.visibleCandidates.clear();
  }
}
