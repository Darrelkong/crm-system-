import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CUSTOMER_INTENT_PREFETCH_COOLDOWN_MS,
  CUSTOMER_INTENT_DESKTOP_DWELL_MS,
  CUSTOMER_INTENT_MOBILE_DWELL_MS,
  CustomerIntentPrefetchController,
  type CustomerIntentPrefetchDeps,
  type CustomerIntentPrefetchTimerId,
  customerDetailHref,
  isMobileViewportProminent,
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

  return { controller, prefetched, advance, setNow: (value: number) => {
    now = value;
  } };
}

function readCustomersListClientSource(): string {
  return readFileSync(
    "src/app/(dashboard)/customers/customers-list-client.tsx",
    "utf8",
  );
}

describe("customer detail Phase 2B6 intent prefetch", () => {
  it("allows first and second unique routes then blocks a third", () => {
    const { controller, prefetched, advance } = createTestController();
    assert.equal(controller.controlledPrefetch("/customers/a"), true);
    advance(CUSTOMER_INTENT_PREFETCH_COOLDOWN_MS);
    assert.equal(controller.controlledPrefetch("/customers/b"), true);
    advance(CUSTOMER_INTENT_PREFETCH_COOLDOWN_MS);
    assert.equal(controller.controlledPrefetch("/customers/c"), false);
    assert.deepEqual(prefetched, ["/customers/a", "/customers/b"]);
  });

  it("blocks duplicate href prefetch attempts", () => {
    const { controller, prefetched } = createTestController();
    assert.equal(controller.controlledPrefetch("/customers/a"), true);
    assert.equal(controller.controlledPrefetch("/customers/a"), false);
    assert.deepEqual(prefetched, ["/customers/a"]);
  });

  it("enforces cooldown without queueing later attempts", () => {
    const { controller, prefetched, advance } = createTestController();
    assert.equal(controller.controlledPrefetch("/customers/a"), true);
    assert.equal(controller.controlledPrefetch("/customers/b"), false);
    advance(CUSTOMER_INTENT_PREFETCH_COOLDOWN_MS - 1);
    assert.equal(controller.controlledPrefetch("/customers/b"), false);
    advance(1);
    assert.equal(controller.controlledPrefetch("/customers/b"), true);
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

  it("cancels mobile dwell when candidate leaves before dwell completes", () => {
    const { controller, prefetched, advance } = createTestController();
    controller.scheduleMobileDwell("/customers/a");
    advance(CUSTOMER_INTENT_MOBILE_DWELL_MS - 1);
    controller.cancelMobileDwell("/customers/a");
    advance(10);
    assert.deepEqual(prefetched, []);
  });

  it("prefetches once after mobile dwell completes", () => {
    const { controller, prefetched, advance } = createTestController();
    controller.scheduleMobileDwell("/customers/a");
    advance(CUSTOMER_INTENT_MOBILE_DWELL_MS);
    assert.deepEqual(prefetched, ["/customers/a"]);
  });

  it("replaces pending mobile candidate and cancels the previous timer", () => {
    const { controller, prefetched, advance } = createTestController();
    controller.scheduleMobileDwell("/customers/a");
    advance(100);
    controller.scheduleMobileDwell("/customers/b");
    advance(CUSTOMER_INTENT_MOBILE_DWELL_MS);
    assert.deepEqual(prefetched, ["/customers/b"]);
  });

  it("skips prefetch when document is hidden", () => {
    const { controller, prefetched } = createTestController({
      isDocumentHidden: () => true,
    });
    assert.equal(controller.controlledPrefetch("/customers/a"), false);
    assert.deepEqual(prefetched, []);
  });

  it("skips prefetch when offline", () => {
    const { controller, prefetched } = createTestController({
      isOffline: () => true,
    });
    assert.equal(controller.controlledPrefetch("/customers/a"), false);
    assert.deepEqual(prefetched, []);
  });

  it("skips prefetch when saveData is enabled", () => {
    const { controller, prefetched } = createTestController({
      hasSaveData: () => true,
    });
    assert.equal(controller.controlledPrefetch("/customers/a"), false);
    assert.deepEqual(prefetched, []);
  });

  it("skips prefetch while list is actively loading", () => {
    const { controller, prefetched } = createTestController({
      isListBlocked: () => true,
    });
    assert.equal(controller.controlledPrefetch("/customers/a"), false);
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
      isMobileViewportProminent({
        isIntersecting: true,
        intersectionRatio: 0.1,
      }),
      false,
    );
    assert.equal(
      isMobileViewportProminent({
        isIntersecting: false,
        intersectionRatio: 1,
      }),
      false,
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
