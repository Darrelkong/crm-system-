"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import {
  COMPOSE_DEFAULT_CONTENT_LEFT_PX,
  COMPOSE_EXPANDED_MAX_WIDTH_PX,
  computeCollapsedFloatingComposeLayout,
  computeExpandedFloatingComposeLayout,
} from "@/lib/mail/client/compose-floating-layout";

function readMailContentLeft(anchor: HTMLElement | null): number {
  if (!anchor) {
    return COMPOSE_DEFAULT_CONTENT_LEFT_PX;
  }
  return anchor.getBoundingClientRect().left;
}

export function MailFloatingComposePortal({
  anchorRef,
  open,
  expanded,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  expanded: boolean;
  children: React.ReactNode;
}) {
  const [contentLeft, setContentLeft] = useState(COMPOSE_DEFAULT_CONTENT_LEFT_PX);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const update = () => {
      setContentLeft(readMailContentLeft(anchorRef.current));
    };

    update();
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }

    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, open]);

  if (!mounted || !open) {
    return null;
  }

  const layout = expanded
    ? computeExpandedFloatingComposeLayout({
        contentLeft,
        viewportHeight: window.innerHeight,
      })
    : computeCollapsedFloatingComposeLayout({
        contentLeft,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });

  return createPortal(
    <div
      className={cn(
        "mail-floating-compose pointer-events-auto z-40 flex min-h-0 flex-col overflow-hidden border crm-border bg-[var(--color-crm-bg)] shadow-lg",
        expanded
          ? "mail-floating-compose--expanded rounded-none border-l"
          : "rounded-xl",
      )}
      style={layout}
    >
      <div
        className={cn(
          "flex h-full min-h-0 w-full flex-col overflow-hidden",
          expanded && "mx-auto max-w-[var(--mail-compose-expanded-max-width)]",
        )}
        style={
          expanded
            ? ({
                "--mail-compose-expanded-max-width": `${COMPOSE_EXPANDED_MAX_WIDTH_PX}px`,
              } as React.CSSProperties)
            : undefined
        }
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
