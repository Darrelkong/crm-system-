"use client";

import { useCallback, useRef } from "react";
import { cn } from "@/lib/cn";

export function MailPaneResizer({
  onResize,
  onResizeEnd,
  onDoubleClickReset,
  className,
  style,
}: {
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
  onDoubleClickReset: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      dragging.current = true;
      lastX.current = e.clientX;
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      const delta = e.clientX - lastX.current;
      lastX.current = e.clientX;
      onResize(delta);
    },
    [onResize],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      onResizeEnd?.();
    },
    [onResizeEnd],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      style={style}
      className={cn("mail-pane-resizer group relative shrink-0", className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClickReset}
    >
      <div className="mail-pane-resizer-line absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--color-crm-border)] transition-colors group-hover:bg-[var(--color-crm-primary)]/40" />
    </div>
  );
}
