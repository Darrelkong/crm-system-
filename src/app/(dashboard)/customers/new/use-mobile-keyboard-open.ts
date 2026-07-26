"use client";

import { useEffect, useState } from "react";

const MOBILE_MQ = "(max-width: 767px)";
/** Shrink vs layout viewport that typically indicates a soft keyboard. */
const KEYBOARD_SHRINK_PX = 120;

/**
 * Mobile-only: hide fixed chrome while the soft keyboard is open.
 * No-ops when `visualViewport` is missing or viewport is desktop-sized.
 */
export function useMobileKeyboardOpen(): boolean {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mq = window.matchMedia(MOBILE_MQ);
    const vv = window.visualViewport;

    if (!vv) {
      return;
    }

    let raf = 0;

    const clearOpen = () => {
      setKeyboardOpen((prev) => (prev ? false : prev));
    };

    const update = () => {
      cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        if (!mq.matches) {
          clearOpen();
          return;
        }
        const shrink = window.innerHeight - vv.height;
        const next = shrink > KEYBOARD_SHRINK_PX;
        setKeyboardOpen((prev) => (prev === next ? prev : next));
      });
    };

    const onMqChange = () => {
      if (!mq.matches) clearOpen();
      else update();
    };

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    mq.addEventListener("change", onMqChange);
    update();

    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      mq.removeEventListener("change", onMqChange);
    };
  }, []);

  return keyboardOpen;
}
