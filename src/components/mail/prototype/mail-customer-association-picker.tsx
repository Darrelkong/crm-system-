"use client";

import { useEffect, useRef, useState } from "react";
import { Link2, X } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import { searchAssociableCustomers } from "@/lib/mail/prototype/recipient-permissions";

export function MailCustomerAssociationPicker({
  value,
  onChange,
  compact,
}: {
  value: { id: string; name: string } | null;
  onChange: (next: { id: string; name: string } | null) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { scenario } = useMailPrototype();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const results = searchAssociableCustomers(query, scenario);

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

  if (value) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-1 text-xs text-blue-700 dark:text-blue-300">
          {t("mail.association.badge", { name: value.name })}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="inline-flex items-center gap-1 text-xs crm-text-secondary hover:crm-text"
        >
          <X className="h-3 w-3" />
          {t("mail.association.remove")}
        </button>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          compact
            ? "inline-flex items-center gap-1 text-xs crm-text-secondary hover:crm-text"
            : "inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-sm crm-text-secondary hover:bg-black/[0.03] hover:crm-text dark:hover:bg-white/[0.04]"
        }
      >
        <Link2 className="h-3.5 w-3.5" />
        {t("mail.association.link")}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-[min(280px,90vw)] rounded-md border crm-border bg-[var(--color-crm-bg)] p-2 shadow-sm">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("mail.association.searchPlaceholder")}
            className="w-full rounded-md border crm-border bg-transparent px-2 py-1.5 text-sm crm-text"
            autoFocus
          />
          <ul className="mt-1 max-h-40 overflow-y-auto">
            {results.length === 0 ? (
              <li className="px-2 py-2 text-xs crm-text-secondary">
                {t("mail.association.noResults")}
              </li>
            ) : (
              results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col px-2 py-1.5 text-left text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                    onClick={() => {
                      onChange({ id: c.id, name: c.name });
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <span className="font-medium crm-text">{c.name}</span>
                    <span className="text-xs crm-text-secondary">
                      {c.customerCode} · {c.email}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
