"use client";

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { cn } from "@/lib/cn";

type Props = {
  open: boolean;
  title: string;
  description?: string;
  onRequestClose: () => void;
  /** When true, Esc / overlay close are ignored (e.g. while submitting). */
  closeBlocked?: boolean;
  closeLabel?: string;
  headerExtra?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  labelledById?: string;
};

function getFocusable(root: HTMLElement): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  return Array.from(nodes).filter(
    (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
  );
}

/**
 * Right-side Drawer (desktop/tablet) / full-screen Sheet (mobile) for Quick Entry.
 * No third-party dependency. Focus trap + Esc + return-focus included.
 */
export function QuickEntryDrawer({
  open,
  title,
  description,
  onRequestClose,
  closeBlocked = false,
  closeLabel = "Close",
  headerExtra,
  footer,
  children,
  initialFocusRef,
  returnFocusRef,
  labelledById,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const autoTitleId = useId();
  const titleId = labelledById ?? autoTitleId;
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTarget =
      initialFocusRef?.current ??
      panelRef.current?.querySelector<HTMLElement>(
        "input:not([disabled]), button:not([disabled]), textarea:not([disabled])",
      ) ??
      panelRef.current;
    focusTarget?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocusRef?.current?.focus();
    };
  }, [open, initialFocusRef, returnFocusRef]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (closeBlocked) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        onRequestClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = getFocusable(panelRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !panelRef.current.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, closeBlocked, onRequestClose]);

  if (!open) return null;

  return (
    <div className="qe-drawer-root" role="presentation">
      <button
        type="button"
        className="qe-drawer-overlay"
        aria-label={closeLabel}
        disabled={closeBlocked}
        onClick={() => {
          if (!closeBlocked) onRequestClose();
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn("qe-drawer-panel", "outline-none")}
      >
        <header className="qe-drawer-header">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="qe-drawer-title">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="qe-drawer-desc">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="qe-drawer-close"
            aria-label={closeLabel}
            disabled={closeBlocked}
            onClick={() => {
              if (!closeBlocked) onRequestClose();
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
          {headerExtra ? (
            <div className="qe-drawer-header-extra">{headerExtra}</div>
          ) : null}
        </header>
        <div className="qe-drawer-body">{children}</div>
        {footer ? <footer className="qe-drawer-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
