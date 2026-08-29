"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Search, Smile } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { MailComposeAnchoredPopover } from "@/components/mail/compose/mail-compose-anchored-popover";
import {
  filterMailComposeEmoji,
  MAIL_COMPOSE_EMOJI_CATEGORIES,
  type MailComposeEmojiCategoryId,
} from "@/lib/mail/client/mail-compose-emoji-data";

export function MailComposeEmojiPicker({
  onInsert,
  className,
}: {
  onInsert: (emoji: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] =
    useState<MailComposeEmojiCategoryId>("smileys");
  const anchorRef = useRef<HTMLButtonElement>(null);
  const buttonId = useId();
  const panelId = useId();

  const visibleEmoji = useMemo(() => {
    if (query.trim()) {
      return MAIL_COMPOSE_EMOJI_CATEGORIES.flatMap((category) =>
        filterMailComposeEmoji(query, category.id),
      ).filter((emoji, index, list) => list.indexOf(emoji) === index);
    }
    return filterMailComposeEmoji("", activeCategory);
  }, [activeCategory, query]);

  return (
    <>
      <button
        ref={anchorRef}
        id={buttonId}
        type="button"
        aria-label={t("mail.compose.insertEmoji")}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "mail-compose-toolbar-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-base crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]",
          className,
        )}
      >
        <Smile className="h-4 w-4" />
      </button>
      <MailComposeAnchoredPopover
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        placement="above"
        align="end"
      >
        <div
          id={panelId}
          role="dialog"
          aria-labelledby={buttonId}
          className="flex w-[320px] max-w-[min(92vw,320px)] flex-col rounded-lg border crm-border bg-[var(--color-crm-bg)] shadow-lg"
        >
          <div className="border-b crm-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 crm-text-secondary" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("mail.compose.emojiSearch")}
                className="h-8 w-full rounded-md border crm-border bg-transparent pl-7 pr-2 text-sm crm-text outline-none"
              />
            </div>
          </div>
          {!query.trim() ? (
            <div className="flex gap-1 overflow-x-auto border-b crm-border px-2 py-1.5">
              {MAIL_COMPOSE_EMOJI_CATEGORIES.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setActiveCategory(category.id)}
                  className={cn(
                    "shrink-0 rounded-md px-2 py-1 text-[11px] crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]",
                    activeCategory === category.id &&
                      "bg-black/[0.06] crm-text dark:bg-white/[0.08]",
                  )}
                >
                  {category.label}
                </button>
              ))}
            </div>
          ) : null}
          <div className="max-h-[280px] overflow-y-auto p-2">
            <div className="grid grid-cols-8 gap-0.5">
              {visibleEmoji.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                  aria-label={t("mail.compose.insertEmoji")}
                  onClick={() => {
                    onInsert(emoji);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      </MailComposeAnchoredPopover>
    </>
  );
}

export function insertTextAtCaret(
  editor: HTMLDivElement | null,
  text: string,
): void {
  if (!editor) return;
  editor.focus();
  document.execCommand("insertText", false, text);
}
