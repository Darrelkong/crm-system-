"use client";

import { Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import { MailMessageRow } from "./mail-message-row";
import { MailSharedFilterBar } from "./mail-shared-filter-bar";

export function MailMessageList({
  className,
  onMessageSelect,
}: {
  className?: string;
  onMessageSelect?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const {
    filteredMessages,
    selectedId,
    setSelectedId,
    markMessageRead,
    searchQuery,
    setSearchQuery,
  } = useMailPrototype();

  return (
    <div className={cn("min-w-0", className)}>
      <div className="border-b crm-border px-3 py-1.5 sm:px-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 crm-text-secondary" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("mail.search.placeholder")}
            className="min-h-9 w-full max-w-full rounded-md border crm-border bg-transparent py-1.5 pl-8 pr-3 text-sm crm-text"
          />
        </div>
      </div>
      <MailSharedFilterBar />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {filteredMessages.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm crm-text-secondary">
            {t("mail.list.empty")}
          </p>
        ) : (
          filteredMessages.map((msg) => (
            <MailMessageRow
              key={msg.id}
              message={msg}
              selected={selectedId === msg.id}
              onSelect={() => {
                setSelectedId(msg.id);
                markMessageRead(msg.id);
                onMessageSelect?.(msg.id);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
