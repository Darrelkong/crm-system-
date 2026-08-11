import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CUSTOMER_INTENT_DESKTOP_DWELL_MS,
  CUSTOMER_INTENT_DESKTOP_PREFETCH_MAX,
  CUSTOMER_INTENT_MOBILE_PREFETCH_MAX,
  CUSTOMER_INTENT_MOBILE_STABLE_WINDOW_MS,
  CUSTOMER_INTENT_PREFETCH_COOLDOWN_MS,
  CustomerIntentPrefetchController,
  type CustomerIntentPrefetchDeps,
  type CustomerIntentPrefetchTimerId,
  customerDetailHref,
  isMobileViewportProminent,
  takeTopVisibleCandidates,
  visibleCandidateFromEntry,
} from "@/lib/customers/customer-intent-prefetch";

type TimerEntry = {
  fn: () => void;
  dueAt: number;
};

function createTestController(
  overrides: Partial<CustomerIntentPrefetchDeps> = {},
) {
  const prefetched: string[] = [];
  let now = 0;
  let nextTimerId = 1;
  const timers = new Map<number, TimerEntry>();

  const deps: CustomerIntentPrefetchDeps = {
    prefetch: (href: string) => {
      prefetched.push(href);
    },
    now: () => now,
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextTimerId++;
      timers.set(id, { fn, dueAt: now + ms });
      return id;
    },
    clearTimeout: (id: CustomerIntentPrefetchTimerId) => {
      timers.delete(id);
    },
    isListBlocked: () => false,
    isDocumentHidden: () => false,
    isOffline: () => false,
    hasSaveData: () => false,
    ...overrides,
  };

  const controller = new CustomerIntentPrefetchController(deps);

  function advance(ms: number) {
    now += ms;
    for (const [id, timer] of [...timers.entries()]) {
      if (timer.dueAt <= now) {
        timers.delete(id);
        timer.fn();
      }
    }
  }

  return {
    controller,
    prefetched,
    advance,
    setNow: (value: number) => {
      now = value;
    },
  };
}

function intersectEntry({
  isIntersecting,
  intersectionRatio,
  top,
  height,
}: {
  isIntersecting: boolean;
  intersectionRatio: number;
  top: number;
  height: number;
}) {
  return {
    isIntersecting,
    intersectionRatio,
    boundingClientRect: {
      top,
      height,
      bottom: top + height,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    },
  };
}

function readCustomersListClientSource(): string {
  return readFileSync(
    "src/app/(dashboard)/customers/customers-list-client.tsx",
    "utf8",
  );
}

describe("customer detail Phase 2B6 intent prefetch", () => {
  it("limits desktop prefetches to two unique routes per list mount", () => {
    const { controller, prefetched, advance } = createTestController();
    controller.scheduleDesktopDwell("/customers/a");
    advance(CUSTOMER_INTENT_DESKTOP_DWELL_MS);
    advance(CUSTOMER_INTENT_PREFETCH_COOLDOWN_MS);
    controller.scheduleDesktopDwell("/customers/b");
    advance(CUSTOMER_INTENT_DESKTOP_DWELL_MS);
    advance(CUSTOMER_INTENT_PREFETCH_COOLDOWN_MS);
    controller.scheduleDesktopDwell("/customers/c");
    advance(CUSTOMER_INTENT_DESKTOP_DWELL_MS);
    assert.deepEqual(prefetched, ["/customers/a", "/customers/b"]);
    assert.equal(controller.getDesktopPrefetchCount(), CUSTOMER_INTENT_DESKTOP_PREFETCH_MAX);
  });

  it("blocks duplicate href prefetch attempts", () => {
    const { controller, prefetched, advance } = createTestController();
    controller.scheduleDesktopDwell("/customers/a");
    advance(CUSTOMER_INTENT_DESKTOP_DWELL_MS);
    controller.scheduleDesktopDwell("/customers/a");
    advance(CUSTOMER_INTENT_DESKTOP_DWELL_MS);
    assert.deepEqual(prefetched, ["/customers/a"]);
  });

  it("enforces cooldown without queueing later desktop attempts", () => {
    const { controller, prefetched, advance } = createTestController();
    controller.scheduleDesktopDwell("/customers/a");
    advance(CUSTOMER_INTENT_DESKTOP_DWELL_MS);
    assert.deepEqual(prefetched, ["/customers/a"]);
    controller.scheduleDesktopDwell("/customers/b");
    advance(CUSTOMER_INTENT_DESKTOP_DWELL_MS);
    assert.deepEqual(prefetched, ["/customers/a"]);
    advance(CUSTOMER_INTENT_PREFETCH_COOLDOWN_MS);
    controller.scheduleDesktopDwell("/customers/b");
    advance(CUSTOMER_INTENT_DESKTOP_DWELL_MS);
    assert.deepEqual(prefetched, ["/customers/a", "/customers/b"]);
  });

  it("cancels desktop dwell when hover ends before dwell completes", () => {
    const { controller, prefetched, advance } = createTestController();
    controller.scheduleDesktopDwell("/customers/a");
    advance(CUSTOMER_INTENT_DESKTOP_DWELL_MS - 1);
    controller.cancelDesktopDwell();
    advance(10);
    assert.deepEqual(prefetched, []);
  });

  it("prefetches once after desktop dwell completes", () => {
    const { controller, prefetched, advance } = createTestController();
    controller.scheduleDesktopDwell("/customers/a");
    advance(CUSTOMER_INTENT_DESKTOP_DWELL_MS);
    assert.deepEqual(prefetched, ["/customers/a"]);
  });

  it("selects only five candidates when eight are visible", () => {
    const candidates = Array.from({ length: 8 }, (_, index) => ({
      href: `/customers/${index + 1}`,
      centerY: 100 + index * 80,
    }));
    const selected = takeTopVisibleCandidates(candidates, 400);
    assert.equal(selected.length, 5);
  });

  it("selects only three candidates when three are visible", () => {
    const candidates = [
      { href: "/customers/a", centerY: 100 },
      { href: "/customers/b", centerY: 200 },
      { href: "/customers/c", centerY: 300 },
    ];
    const selected = takeTopVisibleCandidates(candidates, 250);
    assert.deepEqual(selected, ["/customers/b", "/customers/c", "/customers/a"]);
  });

  it("sorts visible candidates by distance to viewport center", () => {
    const selected = takeTopVisibleCandidates(
      [
        { href: "/customers/far", centerY: 50 },
        { href: "/customers/center", centerY: 400 },
        { href: "/customers/near", centerY: 420 },
      ],
      400,
    );
    assert.deepEqual(selected, [
      "/customers/center",
      "/customers/near",
      "/customers/far",
    ]);
  });

  it("waits for stable viewport before mobile prefetch", () => {
    const { controller, prefetched, advance } = createTestController();
    const viewportCenterY = 400;
    controller.updateMobileCardVisibility(
      "/customers/a",
      intersectEntry({
        isIntersecting: true,
        intersectionRatio: 1,
        top: 360,
        height: 80,
      }),
      viewportCenterY,
    );
    advance(CUSTOMER_INTENT_MOBILE_STABLE_WINDOW_MS - 1);
    assert.deepEqual(prefetched, []);
    advance(1);
    assert.deepEqual(prefetched, ["/customers/a"]);
  });

  it("restarts stable debounce when visible candidates change", () => {
    const { controller, prefetched, advance } = createTestController();
    const viewportCenterY = 400;
    controller.updateMobileCardVisibility(
      "/customers/a",
      intersectEntry({
        isIntersecting: true,
        intersectionRatio: 1,
        top: 360,
        height: 80,
      }),
      viewportCenterY,
    );
    advance(300);
    controller.updateMobileCardVisibility(
      "/customers/b",
      intersectEntry({
        isIntersecting: true,
        intersectionRatio: 1,
        top: 440,
        height: 80,
      }),
      viewportCenterY,
    );
    advance(CUSTOMER_INTENT_MOBILE_STABLE_WINDOW_MS - 1);
    assert.deepEqual(prefetched, []);
    advance(1);
    assert.deepEqual(prefetched, ["/customers/a"]);
  });

  it("prefetches visible mobile queue sequentially with cooldown", () => {
    const { controller, prefetched, advance } = createTestController();
    const viewportCenterY = 400;
    for (const [href, top] of [
      ["/customers/a", 100],
      ["/customers/b", 200],
      ["/customers/c", 300],
    ] as const) {
      controller.updateMobileCardVisibility(
        href,
        intersectEntry({
          isIntersecting: true,
          intersectionRatio: 1,
          top,
          height: 80,
        }),
        viewportCenterY,
      );
    }
    advance(CUSTOMER_INTENT_MOBILE_STABLE_WINDOW_MS);
    assert.deepEqual(prefetched, ["/customers/c"]);
    advance(CUSTOMER_INTENT_PREFETCH_COOLDOWN_MS - 1);
    assert.deepEqual(prefetched, ["/customers/c"]);
    advance(1);
    assert.deepEqual(prefetched, ["/customers/c", "/customers/b"]);
  });

  it("blocks a sixth unique mobile manual prefetch during the same mount", () => {
    const { controller, prefetched, advance } = createTestController();
    const viewportCenterY = 400;
    const hrefs = ["a", "b", "c", "d", "e", "f"].map(
      (id) => `/customers/${id}`,
    );

    for (const [index, href] of hrefs.entries()) {
      controller.updateMobileCardVisibility(
        href,
        intersectEntry({
          isIntersecting: true,
          intersectionRatio: 1,
          top: 100 + index * 80,
          height: 80,
        }),
        viewportCenterY,
      );
    }

    advance(CUSTOMER_INTENT_MOBILE_STABLE_WINDOW_MS);
    for (let step = 0; step < CUSTOMER_INTENT_MOBILE_PREFETCH_MAX - 1; step += 1) {
      advance(CUSTOMER_INTENT_PREFETCH_COOLDOWN_MS);
    }
    assert.equal(prefetched.length, CUSTOMER_INTENT_MOBILE_PREFETCH_MAX);
    advance(CUSTOMER_INTENT_PREFETCH_COOLDOWN_MS);
    assert.equal(prefetched.length, CUSTOMER_INTENT_MOBILE_PREFETCH_MAX);
    assert.equal(controller.getMobilePrefetchCount(), CUSTOMER_INTENT_MOBILE_PREFETCH_MAX);
  });

  it("does not prefetch the same href twice after scroll away and back", () => {
    const { controller, prefetched, advance } = createTestController();
    const viewportCenterY = 400;
    const entry = intersectEntry({
      isIntersecting: true,
      intersectionRatio: 1,
      top: 360,
      height: 80,
    });

    controller.updateMobileCardVisibility("/customers/a", entry, viewportCenterY);
    advance(CUSTOMER_INTENT_MOBILE_STABLE_WINDOW_MS);
    assert.deepEqual(prefetched, ["/customers/a"]);

    controller.updateMobileCardVisibility(
      "/customers/a",
      intersectEntry({
        isIntersecting: false,
        intersectionRatio: 0,
        top: 900,
        height: 80,
      }),
      viewportCenterY,
    );
    advance(CUSTOMER_INTENT_MOBILE_STABLE_WINDOW_MS);
    controller.updateMobileCardVisibility("/customers/a", entry, viewportCenterY);
    advance(CUSTOMER_INTENT_MOBILE_STABLE_WINDOW_MS);
    assert.deepEqual(prefetched, ["/customers/a"]);
  });

  it("cancels pending queue when visible set changes before next prefetch", () => {
    const { controller, prefetched, advance } = createTestController();
    const viewportCenterY = 400;
    controller.updateMobileCardVisibility(
      "/customers/a",
      intersectEntry({
        isIntersecting: true,
        intersectionRatio: 1,
        top: 360,
        height: 80,
      }),
      viewportCenterY,
    );
    controller.updateMobileCardVisibility(
      "/customers/b",
      intersectEntry({
        isIntersecting: true,
        intersectionRatio: 1,
        top: 440,
        height: 80,
      }),
      viewportCenterY,
    );
    advance(CUSTOMER_INTENT_MOBILE_STABLE_WINDOW_MS);
    assert.deepEqual(prefetched, ["/customers/a"]);

    controller.updateMobileCardVisibility(
      "/customers/a",
      intersectEntry({
        isIntersecting: false,
        intersectionRatio: 0,
        top: 900,
        height: 80,
      }),
      viewportCenterY,
    );
    controller.updateMobileCardVisibility(
      "/customers/b",
      intersectEntry({
        isIntersecting: false,
        intersectionRatio: 0,
        top: 900,
        height: 80,
      }),
      viewportCenterY,
    );
    controller.updateMobileCardVisibility(
      "/customers/d",
      intersectEntry({
        isIntersecting: true,
        intersectionRatio: 1,
        top: 380,
        height: 80,
      }),
      viewportCenterY,
    );
    controller.updateMobileCardVisibility(
      "/customers/e",
      intersectEntry({
        isIntersecting: true,
        intersectionRatio: 1,
        top: 460,
        height: 80,
      }),
      viewportCenterY,
    );
    advance(CUSTOMER_INTENT_MOBILE_STABLE_WINDOW_MS);
    advance(CUSTOMER_INTENT_PREFETCH_COOLDOWN_MS);
    assert.deepEqual(prefetched, ["/customers/a", "/customers/d"]);
    assert.equal(prefetched.includes("/customers/b"), false);
  });

  it("skips prefetch when document is hidden", () => {
    const { controller, prefetched, advance } = createTestController({
      isDocumentHidden: () => true,
    });
    controller.scheduleDesktopDwell("/customers/a");
    advance(CUSTOMER_INTENT_DESKTOP_DWELL_MS);
    assert.deepEqual(prefetched, []);
  });

  it("skips prefetch when offline", () => {
    const { controller, prefetched, advance } = createTestController({
      isOffline: () => true,
    });
    controller.scheduleDesktopDwell("/customers/a");
    advance(CUSTOMER_INTENT_DESKTOP_DWELL_MS);
    assert.deepEqual(prefetched, []);
  });

  it("skips prefetch when saveData is enabled", () => {
    const { controller, prefetched, advance } = createTestController({
      hasSaveData: () => true,
    });
    controller.scheduleDesktopDwell("/customers/a");
    advance(CUSTOMER_INTENT_DESKTOP_DWELL_MS);
    assert.deepEqual(prefetched, []);
  });

  it("skips prefetch while list is actively loading", () => {
    const { controller, prefetched, advance } = createTestController({
      isListBlocked: () => true,
    });
    controller.updateMobileCardVisibility(
      "/customers/a",
      intersectEntry({
        isIntersecting: true,
        intersectionRatio: 1,
        top: 360,
        height: 80,
      }),
      400,
    );
    advance(CUSTOMER_INTENT_MOBILE_STABLE_WINDOW_MS);
    assert.deepEqual(prefetched, []);
  });

  it("requires prominent mobile viewport intersection", () => {
    assert.equal(
      isMobileViewportProminent({
        isIntersecting: true,
        intersectionRatio: 0.75,
      }),
      true,
    );
    assert.equal(
      visibleCandidateFromEntry(
        "/customers/a",
        intersectEntry({
          isIntersecting: true,
          intersectionRatio: 0.1,
          top: 100,
          height: 80,
        }),
      ),
      null,
    );
  });

  it("builds customer detail href without customer identifiers in helper", () => {
    assert.equal(customerDetailHref("abc"), "/customers/abc");
  });

  it("preserves customer list navigation without global prefetch props", () => {
    const source = readCustomersListClientSource();
    assert.match(source, /customerDetailHref\(c\.id\)/g);
    assert.match(source, /href=\{detailHref\}/g);
    assert.doesNotMatch(source, /prefetch=\{true\}/);
    assert.doesNotMatch(source, /prefetch=\{false\}/);
    assert.doesNotMatch(source, /preventDefault/);
    assert.doesNotMatch(source, /router\.push/);
    assert.match(source, /useCustomerIntentPrefetch/);
  });
});
