"use client";

import { useEffect, useRef, useState } from "react";
import { Forward, Loader2, MoreHorizontal, Reply, ReplyAll } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import type { ComposeDraftSeedMode } from "@/lib/mail/client/draft-management";

export type ProductionComposeSeedAction = ComposeDraftSeedMode;

export function MailProductionMessageActions({
  messageId,
  onSeedAction,
  pending = false,
  variant = "desktop",
}: {
  messageId: string;
  onSeedAction: (messageId: string, mode: ProductionComposeSeedAction) => void;
  pending?: boolean;
  variant?: "desktop" | "mobile";
}) {
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    function handleClick(event: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [moreOpen]);

  const invoke = (mode: ProductionComposeSeedAction) => {
    if (pending) return;
    onSeedAction(messageId, mode);
  };

  if (variant === "mobile") {
    return (
      <div className="flex items-center gap-2">
        <Button
          type="button"
          className="flex-1"
          disabled={pending}
          aria-busy={pending}
          onClick={() => invoke("reply")}
        >
          {pending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : null}
          {t("mail.compose.reply")}
        </Button>
        <div ref={moreRef} className="relative">
          <button
            type="button"
            disabled={pending}
            onClick={() => setMoreOpen((value) => !value)}
            className="flex min-h-10 min-w-10 items-center justify-center rounded-xl border crm-border disabled:opacity-50"
            aria-label={t("common.actions")}
            aria-expanded={moreOpen}
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
          {moreOpen && (
            <div className="absolute bottom-full right-0 z-40 mb-1 w-44 rounded-md border crm-border bg-[var(--color-crm-bg)] py-1 shadow-sm">
              <ActionMenuItem
                icon={<ReplyAll className="h-4 w-4" />}
                label={t("mail.compose.replyAll")}
                onClick={() => {
                  invoke("reply_all");
                  setMoreOpen(false);
                }}
              />
              <ActionMenuItem
                icon={<Forward className="h-4 w-4" />}
                label={t("mail.compose.forward")}
                onClick={() => {
                  invoke("forward");
                  setMoreOpen(false);
                }}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <ToolbarButton
        icon={
          pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Reply className="h-4 w-4" />
          )
        }
        label={t("mail.compose.reply")}
        disabled={pending}
        onClick={() => invoke("reply")}
      />
      <ToolbarButton
        icon={<ReplyAll className="h-4 w-4" />}
        label={t("mail.compose.replyAll")}
        disabled={pending}
        onClick={() => invoke("reply_all")}
      />
      <ToolbarButton
        icon={<Forward className="h-4 w-4" />}
        label={t("mail.compose.forward")}
        disabled={pending}
        onClick={() => invoke("forward")}
      />
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={disabled}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-sm crm-text-secondary hover:bg-black/[0.04] hover:crm-text disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/[0.06]"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ActionMenuItem({
  icon,
  label,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm crm-text hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
    >
      {icon}
      {label}
    </button>
  );
}
