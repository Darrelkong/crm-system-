"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type KnowledgeMobileSheetProps = {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
};

export function KnowledgeMobileSheet({
  open,
  title,
  description,
  onClose,
  closeLabel,
  children,
}: KnowledgeMobileSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/40"
        aria-label={closeLabel}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "absolute inset-x-0 bottom-0 max-h-[85vh] overflow-hidden rounded-t-2xl bg-white shadow-2xl outline-none",
          "md:inset-auto md:left-1/2 md:top-1/2 md:w-full md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl",
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold crm-text">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-0.5 text-sm crm-text-secondary">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="shrink-0 rounded-lg px-2 py-1 text-sm crm-text-secondary hover:bg-slate-100"
            aria-label={closeLabel}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="max-h-[calc(85vh-3.5rem)] overflow-y-auto px-4 py-3">
          {children}
        </div>
      </div>
    </div>
  );
}
