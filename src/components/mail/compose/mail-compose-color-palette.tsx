"use client";

import { useId, useRef, useState } from "react";
import { Palette } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { MAIL_COMPOSE_TEXT_COLORS } from "@/components/mail/compose/mail-compose-text-colors";
import { MailComposeAnchoredPopover } from "@/components/mail/compose/mail-compose-anchored-popover";

export function MailComposeColorPalette({
  onSelectColor,
  className,
}: {
  onSelectColor: (color: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string>(MAIL_COMPOSE_TEXT_COLORS[0]);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const buttonId = useId();
  const panelId = useId();

  return (
    <>
      <button
        ref={anchorRef}
        id={buttonId}
        type="button"
        aria-label={t("mail.compose.textColor")}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "mail-compose-toolbar-btn relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]",
          className,
        )}
      >
        <Palette className="h-3.5 w-3.5" />
        <span
          className="absolute bottom-1 right-1 h-2 w-2 rounded-full border border-white/80 dark:border-black/40"
          style={{ backgroundColor: selected }}
          aria-hidden
        />
      </button>
      <MailComposeAnchoredPopover
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        placement="above"
      >
        <div
          id={panelId}
          role="dialog"
          aria-labelledby={buttonId}
          className="w-[220px] rounded-lg border crm-border bg-[var(--color-crm-bg)] p-2 shadow-lg"
        >
          <p className="mb-2 px-1 text-[11px] font-medium crm-text-secondary">
            {t("mail.compose.textColor")}
          </p>
          <div className="grid grid-cols-6 gap-1">
            {MAIL_COMPOSE_TEXT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`${t("mail.compose.textColor")} ${color}`}
                aria-pressed={selected === color}
                onClick={() => {
                  setSelected(color);
                  onSelectColor(color);
                  setOpen(false);
                }}
                className={cn(
                  "h-6 w-6 rounded-md border crm-border transition-transform hover:scale-105",
                  selected === color &&
                    "ring-2 ring-[var(--color-crm-primary)] ring-offset-1",
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      </MailComposeAnchoredPopover>
    </>
  );
}
