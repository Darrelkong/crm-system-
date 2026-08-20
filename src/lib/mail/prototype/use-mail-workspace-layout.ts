"use client";

import { useEffect, useState, type RefObject } from "react";

/** Layout modes based on mail workspace container width — not viewport. */
export type MailLayoutMode = "wide" | "medium" | "narrow";

/** Comfortable three-column layout (folder + list + detail). */
const WIDE_MIN = 1040;
/** Tighter three-column — folders stay visible. */
const MEDIUM_MIN = 720;

function modeFromWidth(width: number): MailLayoutMode {
  if (width >= WIDE_MIN) return "wide";
  if (width >= MEDIUM_MIN) return "medium";
  return "narrow";
}

export function useMailWorkspaceLayout(
  containerRef: RefObject<HTMLElement | null>,
): MailLayoutMode {
  const [mode, setMode] = useState<MailLayoutMode>("wide");

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = (width: number) => {
      setMode(modeFromWidth(width));
    };

    update(el.getBoundingClientRect().width);

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) update(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  return mode;
}
