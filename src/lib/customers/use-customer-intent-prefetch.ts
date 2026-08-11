"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CUSTOMER_INTENT_MOBILE_MIN_RATIO,
  CustomerIntentPrefetchController,
  isCoarsePointerEnvironment,
} from "@/lib/customers/customer-intent-prefetch";

type Options = {
  listBlocked: boolean;
};

export function useCustomerIntentPrefetch({ listBlocked }: Options) {
  const router = useRouter();
  const routerRef = useRef(router);
  const listBlockedRef = useRef(listBlocked);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementHrefsRef = useRef(new WeakMap<Element, string>());

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  // Controller callbacks read refs only when prefetch intent fires, not during render.
  // eslint-disable-next-line react-hooks/refs -- lazy singleton init for list mount
  const [controller] = useState(() => {
    return new CustomerIntentPrefetchController({
      prefetch: (href) => {
        routerRef.current.prefetch(href);
      },
      now: () => Date.now(),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) =>
        window.clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
      isListBlocked: () => listBlockedRef.current,
      isDocumentHidden: () =>
        typeof document !== "undefined" && document.hidden,
      isOffline: () =>
        typeof navigator !== "undefined" && navigator.onLine === false,
      hasSaveData: () => {
        const connection = (
          navigator as Navigator & {
            connection?: { saveData?: boolean };
          }
        ).connection;
        return connection?.saveData === true;
      },
    });
  });

  useEffect(() => {
    listBlockedRef.current = listBlocked;
    if (listBlocked) {
      controller.cancelMobilePrefetching();
    }
  }, [listBlocked, controller]);

  useEffect(() => {
    return () => {
      controller.dispose();
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [controller]);

  function ensureMobileObserver(): IntersectionObserver | null {
    if (typeof window === "undefined") {
      return null;
    }
    if (!isCoarsePointerEnvironment(window.matchMedia)) {
      return null;
    }
    if (typeof IntersectionObserver === "undefined") {
      return null;
    }
    if (observerRef.current) {
      return observerRef.current;
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const viewportCenterY = window.innerHeight / 2;
        for (const entry of entries) {
          const href = elementHrefsRef.current.get(entry.target);
          if (!href) {
            continue;
          }
          controller.updateMobileCardVisibility(href, entry, viewportCenterY);
        }
      },
      {
        root: null,
        threshold: [0, CUSTOMER_INTENT_MOBILE_MIN_RATIO, 0.75, 1],
      },
    );
    return observerRef.current;
  }

  return useMemo(
    () => ({
      onDesktopIntentEnter: (href: string) => {
        controller.scheduleDesktopDwell(href);
      },
      onDesktopIntentLeave: () => {
        controller.cancelDesktopDwell();
      },
      registerMobileCard: (element: HTMLElement | null, href: string) => {
        if (!element) {
          return () => {};
        }
        const observer = ensureMobileObserver();
        if (!observer) {
          return () => {};
        }
        elementHrefsRef.current.set(element, href);
        observer.observe(element);
        return () => {
          observer.unobserve(element);
          elementHrefsRef.current.delete(element);
          controller.removeMobileCard(href);
        };
      },
    }),
    // ensureMobileObserver closes over stable refs/controller for the list mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller],
  );
}
