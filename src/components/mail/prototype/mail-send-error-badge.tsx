"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";

export function MailSendErrorBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { isAdminScenario, statusSummary } = useMailPrototype();

  if (!isAdminScenario) return null;

  const count = statusSummary.sendErrors ?? 0;
  if (count <= 0) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-200 ${className ?? ""}`}
      role="status"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {t("mail.status.sendErrors")} {count}
    </span>
  );
}
