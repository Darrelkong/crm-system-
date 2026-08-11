export const CUSTOMER_INTENT_PREFETCH_MAX = 2;
export const CUSTOMER_INTENT_PREFETCH_COOLDOWN_MS = 3000;
export const CUSTOMER_INTENT_DESKTOP_DWELL_MS = 200;
export const CUSTOMER_INTENT_MOBILE_DWELL_MS = 700;
export const CUSTOMER_INTENT_MOBILE_ROOT_MARGIN = "-20% 0px -20% 0px";
export const CUSTOMER_INTENT_MOBILE_MIN_RATIO = 0.5;

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

export class CustomerIntentPrefetchController {
  private readonly prefetchedHrefs = new Set<string>();
  private uniquePrefetchCount = 0;
  private lastPrefetchAt = -Infinity;
  private desktopTimer: CustomerIntentPrefetchTimerId | null = null;
  private mobileTimer: CustomerIntentPrefetchTimerId | null = null;
  private mobileTimerHref: string | null = null;

  constructor(private readonly deps: CustomerIntentPrefetchDeps) {}

  getPrefetchedCount(): number {
    return this.uniquePrefetchCount;
  }

  hasPrefetched(href: string): boolean {
    return this.prefetchedHrefs.has(href);
  }

  canPrefetch(href: string, at = this.deps.now()): boolean {
    if (this.uniquePrefetchCount >= CUSTOMER_INTENT_PREFETCH_MAX) {
      return false;
    }
    if (this.prefetchedHrefs.has(href)) {
      return false;
    }
    if (at - this.lastPrefetchAt < CUSTOMER_INTENT_PREFETCH_COOLDOWN_MS) {
      return false;
    }
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
    return true;
  }

  controlledPrefetch(href: string, at = this.deps.now()): boolean {
    if (!this.canPrefetch(href, at)) {
      return false;
    }
    this.deps.prefetch(href);
    this.prefetchedHrefs.add(href);
    this.uniquePrefetchCount += 1;
    this.lastPrefetchAt = at;
    return true;
  }

  scheduleDesktopDwell(href: string): void {
    this.cancelDesktopDwell();
    this.desktopTimer = this.deps.setTimeout(() => {
      this.desktopTimer = null;
      this.controlledPrefetch(href);
    }, CUSTOMER_INTENT_DESKTOP_DWELL_MS);
  }

  cancelDesktopDwell(): void {
    if (this.desktopTimer !== null) {
      this.deps.clearTimeout(this.desktopTimer);
      this.desktopTimer = null;
    }
  }

  scheduleMobileDwell(href: string): void {
    if (this.mobileTimerHref !== href) {
      this.cancelMobileDwell();
    }
    if (this.mobileTimer !== null) {
      return;
    }
    this.mobileTimerHref = href;
    this.mobileTimer = this.deps.setTimeout(() => {
      this.mobileTimer = null;
      this.mobileTimerHref = null;
      this.controlledPrefetch(href);
    }, CUSTOMER_INTENT_MOBILE_DWELL_MS);
  }

  cancelMobileDwell(href?: string): void {
    if (href !== undefined && this.mobileTimerHref !== href) {
      return;
    }
    if (this.mobileTimer !== null) {
      this.deps.clearTimeout(this.mobileTimer);
      this.mobileTimer = null;
      this.mobileTimerHref = null;
    }
  }

  dispose(): void {
    this.cancelDesktopDwell();
    this.cancelMobileDwell();
  }
}
