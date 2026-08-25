"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";
import { cn } from "@/lib/cn";

export const MAIL_ADMIN_SECTION_CLASS = "space-y-4";
export const MAIL_ADMIN_CARD_STACK_CLASS = "space-y-3";

export function MailAdminLoadingState({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();

  if (compact) {
    return (
      <div
        className={cn("animate-pulse space-y-3", className)}
        aria-busy="true"
        aria-label={t("common.loading")}
      >
        <div
          className="h-4 w-2/3 rounded-md bg-black/[0.06] dark:bg-white/[0.08]"
          aria-hidden
        />
        <div
          className="h-4 w-1/2 rounded-md bg-black/[0.06] dark:bg-white/[0.08]"
          aria-hidden
        />
        <div
          className="h-4 w-3/5 rounded-md bg-black/[0.06] dark:bg-white/[0.08]"
          aria-hidden
        />
      </div>
    );
  }

  return (
    <div
      className={cn("surface-card p-4 md:p-6", className)}
      aria-busy="true"
      aria-label={t("common.loading")}
    >
      <div className="animate-pulse space-y-3" aria-hidden>
        <div className="h-4 w-1/3 rounded-md bg-black/[0.06] dark:bg-white/[0.08]" />
        <div className="h-16 rounded-md bg-black/[0.06] dark:bg-white/[0.08]" />
        <div className="h-16 rounded-md bg-black/[0.06] dark:bg-white/[0.08]" />
      </div>
    </div>
  );
}

export function MailAdminErrorState({
  message,
  onRetry,
  retryLabel,
  className,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/20",
        className,
      )}
      role="alert"
    >
      <p className="text-sm text-red-600 dark:text-red-400">{message}</p>
      {onRetry ? (
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          {retryLabel ?? t("mail.adminCenter.retry")}
        </Button>
      ) : null}
    </div>
  );
}

export function MailAdminEmptyState({
  message,
  action,
  compact = false,
  className,
}: {
  message: string;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  if (compact) {
    return (
      <div
        className={cn(
          "rounded-lg border border-dashed crm-border px-4 py-6 text-center",
          className,
        )}
      >
        <p className="text-sm crm-text-secondary">{message}</p>
        {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
      </div>
    );
  }

  return (
    <div className={className}>
      <EmptyState message={message} action={action} />
    </div>
  );
}
