"use client";

import { useLayoutEffect, useState } from "react";
import { cn } from "@/lib/cn";
import {
  COMPOSE_DEFAULT_CONTENT_LEFT_PX,
  computeCollapsedFloatingComposeLayout,
} from "@/lib/mail/client/compose-floating-layout";

function readMainContentPaneLeft(anchor: HTMLElement | null): number {
  if (!anchor) {
    return COMPOSE_DEFAULT_CONTENT_LEFT_PX;
  }
  return anchor.getBoundingClientRect().left;
}

export function MailComposeDesktopHost({
  mainContentPaneRef,
  expanded,
  children,
}: {
  mainContentPaneRef: React.RefObject<HTMLElement | null>;
  expanded: boolean;
  children: React.ReactNode;
}) {
  const [contentLeft, setContentLeft] = useState(COMPOSE_DEFAULT_CONTENT_LEFT_PX);
  const [viewport, setViewport] = useState({ width: 1200, height: 800 });

  useLayoutEffect(() => {
    const update = () => {
      setContentLeft(readMainContentPaneLeft(mainContentPaneRef.current));
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    update();
    const anchor = mainContentPaneRef.current;
    if (!anchor) {
      return;
    }

    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    window.addEventListener("resize", update);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [mainContentPaneRef]);

  const floatingLayout = expanded
    ? undefined
    : computeCollapsedFloatingComposeLayout({
        contentLeft,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
      });

  return (
    <div
      className={cn(
        "mail-compose-desktop-host pointer-events-auto flex min-h-0 flex-col overflow-hidden bg-[var(--color-crm-bg)]",
        expanded
          ? "absolute inset-0 z-10"
          : "mail-floating-compose fixed z-40 rounded-xl border crm-border shadow-lg",
      )}
      style={expanded ? undefined : floatingLayout}
      data-compose-host={expanded ? "embedded" : "floating"}
    >
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
