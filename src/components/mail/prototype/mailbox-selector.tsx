"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import { useTranslation } from "@/i18n/provider";

export function MailboxSelector({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { mailboxes, activeMailbox, setActiveMailbox } = useMailPrototype();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (mailboxes.length <= 1) {
    return null;
  }

  const personal = mailboxes.filter((m) => m.label === "personal");
  const shared = mailboxes.filter((m) => m.label === "shared");
  const current = mailboxes.find((m) => m.address === activeMailbox);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-10 w-full min-w-0 max-w-full items-center gap-1.5 rounded-xl border crm-border px-3 py-2 text-sm crm-text"
      >
        <span className="truncate">{current?.address ?? activeMailbox}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 min-w-[240px] rounded-xl border crm-border surface-card p-2 shadow-lg">
          {personal.length > 0 && (
            <div className="mb-1">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide crm-text-secondary">
                {t("mail.mailbox.personal")}
              </p>
              {personal.map((m) => (
                <button
                  key={m.address}
                  type="button"
                  onClick={() => {
                    setActiveMailbox(m.address);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex min-h-10 w-full rounded-lg px-2 py-2 text-left text-sm",
                    m.address === activeMailbox ? "nav-active" : "nav-item",
                  )}
                >
                  {m.address}
                </button>
              ))}
            </div>
          )}
          {shared.length > 0 && (
            <div>
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide crm-text-secondary">
                {t("mail.mailbox.shared")}
              </p>
              {shared.map((m) => (
                <button
                  key={m.address}
                  type="button"
                  onClick={() => {
                    setActiveMailbox(m.address);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex min-h-10 w-full rounded-lg px-2 py-2 text-left text-sm",
                    m.address === activeMailbox ? "nav-active" : "nav-item",
                  )}
                >
                  {m.address}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
