"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { useMailPrototype } from "@/lib/mail/prototype/state";

export function MailFromSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (address: string) => void;
}) {
  const { senderIdentities } = useMailPrototype();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  if (senderIdentities.length <= 1) {
    return (
      <p className="min-h-9 break-all py-1.5 text-sm crm-text">{value}</p>
    );
  }

  const current =
    senderIdentities.find((m) => m.address === value) ?? senderIdentities[0];

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md px-1 py-1 text-left text-sm crm-text hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="min-w-0 truncate">
          {current?.displayName ?? current?.address ?? value}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-1 w-[min(280px,100%)] overflow-hidden rounded-md border crm-border bg-[var(--color-crm-bg)] py-0.5 shadow-sm"
        >
          {senderIdentities.map((box) => {
            const active = box.address === value;
            return (
              <button
                key={box.address}
                type="button"
                role="menuitem"
                onClick={() => {
                  onChange(box.address);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-2 px-2.5 py-2 text-left text-sm",
                  active
                    ? "mail-folder-popover-row-active"
                    : "mail-folder-popover-row-idle",
                )}
              >
                {active ? (
                  <Check className="mt-0.5 h-3 w-3 shrink-0" />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <span className="min-w-0">
                  <span className="block font-medium">
                    {box.displayName ?? box.address}
                  </span>
                  <span className="block truncate text-xs crm-text-secondary">
                    {box.address}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
