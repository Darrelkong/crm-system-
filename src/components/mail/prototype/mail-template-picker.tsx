"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { MOCK_MAIL_TEMPLATES } from "@/lib/mail/prototype/shared-mailbox-data";
import type { MailTemplate } from "@/lib/mail/prototype/shared-mailbox-types";

export function MailTemplatePicker({
  subject,
  onInsert,
  className,
}: {
  subject: string;
  onInsert: (template: MailTemplate, applySubject: boolean) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MOCK_MAIL_TEMPLATES;
    return MOCK_MAIL_TEMPLATES.filter(
      (tpl) =>
        tpl.title.toLowerCase().includes(q) ||
        tpl.category.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm crm-text-secondary hover:crm-text"
      >
        {t("mail.templates.use")}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-[min(280px,90vw)] rounded-md border crm-border bg-[var(--color-crm-bg)] p-2 shadow-md">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("mail.templates.search")}
            className="mb-2 w-full rounded-md border crm-border bg-transparent px-2 py-1.5 text-sm crm-text"
          />
          <ul className="max-h-48 overflow-y-auto">
            {filtered.map((tpl) => (
              <li key={tpl.id}>
                <button
                  type="button"
                  className="flex w-full flex-col px-2 py-2 text-left text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                  onClick={() => {
                    const applySubject = !subject.trim() && Boolean(tpl.subject);
                    onInsert(tpl, applySubject);
                    setOpen(false);
                  }}
                >
                  <span className="text-[10px] crm-text-secondary">
                    {tpl.category}
                  </span>
                  <span className="font-medium crm-text">{tpl.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
