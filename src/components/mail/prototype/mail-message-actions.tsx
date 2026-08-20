"use client";

import { useEffect, useRef, useState } from "react";
import {
  Forward,
  MoreHorizontal,
  Reply,
  ReplyAll,
  Star,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import type { MailMessage } from "@/lib/mail/prototype/types";
import { hasReplyAllTargets } from "@/lib/mail/prototype/message-actions";
import { Button } from "@/components/ui/button";

export function MailMessageActions({
  message,
  onReply,
  onReplyAll,
  onForward,
  variant = "desktop",
  disabled = false,
}: {
  message: MailMessage;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  variant?: "desktop" | "mobile";
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { toggleMessageImportant, isStaffScenario, activeFolder, withdrawApproval } =
    useMailPrototype();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const showReplyAll = hasReplyAllTargets(message);
  const canWithdraw =
    isStaffScenario && message.folder === "pending_approval";

  useEffect(() => {
    if (!moreOpen) return;
    function handleClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [moreOpen]);

  if (variant === "mobile") {
    if (disabled) return null;
    return (
      <div className="flex items-center gap-2">
        <Button type="button" className="flex-1" onClick={onReply}>
          {t("mail.compose.reply")}
        </Button>
        <div ref={moreRef} className="relative">
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className="flex min-h-10 min-w-10 items-center justify-center rounded-xl border crm-border"
            aria-label={t("common.actions")}
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
          {moreOpen && (
            <div className="absolute bottom-full right-0 z-40 mb-1 w-44 rounded-md border crm-border bg-[var(--color-crm-bg)] py-1 shadow-sm">
              {showReplyAll && (
                <ActionMenuItem
                  icon={<ReplyAll className="h-4 w-4" />}
                  label={t("mail.compose.replyAll")}
                  onClick={() => {
                    onReplyAll();
                    setMoreOpen(false);
                  }}
                />
              )}
              <ActionMenuItem
                icon={<Forward className="h-4 w-4" />}
                label={t("mail.compose.forward")}
                onClick={() => {
                  onForward();
                  setMoreOpen(false);
                }}
              />
              <ActionMenuItem
                icon={
                  <Star
                    className={cn(
                      "h-4 w-4",
                      message.isImportant && "fill-amber-400 text-amber-500",
                    )}
                  />
                }
                label={
                  message.isImportant
                    ? t("mail.flag.unflag")
                    : t("mail.flag.important")
                }
                onClick={() => {
                  toggleMessageImportant(message.id);
                  setMoreOpen(false);
                }}
              />
              {canWithdraw && (
                <ActionMenuItem
                  label={t("mail.approval.withdraw")}
                  onClick={() => {
                    withdrawApproval(message.id);
                    setMoreOpen(false);
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (disabled) return null;

  return (
    <div className="flex flex-wrap items-center gap-1">
      <ToolbarButton icon={<Reply className="h-4 w-4" />} label={t("mail.compose.reply")} onClick={onReply} />
      {showReplyAll && (
        <ToolbarButton
          icon={<ReplyAll className="h-4 w-4" />}
          label={t("mail.compose.replyAll")}
          onClick={onReplyAll}
        />
      )}
      <ToolbarButton
        icon={<Forward className="h-4 w-4" />}
        label={t("mail.compose.forward")}
        onClick={onForward}
      />
      <ToolbarButton
        icon={
          <Star
            className={cn(
              "h-4 w-4",
              message.isImportant && "fill-amber-400 text-amber-500",
            )}
          />
        }
        label={
          message.isImportant
            ? t("mail.flag.unflag")
            : t("mail.flag.important")
        }
        onClick={() => toggleMessageImportant(message.id)}
      />
      {canWithdraw && (
        <ToolbarButton
          label={t("mail.approval.withdraw")}
          onClick={() => withdrawApproval(message.id)}
        />
      )}
      {activeFolder === "sent" && message.deliveryStatus && (
        <span className="ml-1 text-xs crm-text-secondary">
          {t(`mail.delivery.${message.deliveryStatus}`)}
        </span>
      )}
    </div>
  );
}

function ToolbarButton({
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
      className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-sm crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]"
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
