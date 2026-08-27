"use client";

import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { MailApprovalStatusBadge } from "@/components/mail/shared/mail-approval-status-badge";
import { useOptionalMailApprovalWorkspace } from "@/lib/mail/client/mail-approval-workspace-context";
import type { ApprovalWorkflowRow } from "@/lib/mail/client/approval-workflow-management";
import { formatHongKongDateTime } from "@/lib/timezone";

function resolveComposeModeLabelKey(
  composeMode: string | undefined,
): string {
  switch (composeMode) {
    case "reply":
    case "reply_all":
      return "mail.approval.composeMode.reply";
    case "forward":
      return "mail.approval.composeMode.forward";
    default:
      return "mail.approval.composeMode.new";
  }
}

function ApprovalQueueRow({
  row,
  composeMode,
  active,
  onSelect,
}: {
  row: ApprovalWorkflowRow;
  composeMode?: string;
  active: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "mail-approval-queue-row w-full border-b crm-border px-3 py-3 text-left transition-colors",
        active ? "bg-[var(--color-crm-bg-muted)]" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.04]",
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium crm-text">{row.subject}</p>
          <p className="mt-1 truncate text-xs crm-text-secondary">
            {row.submitterLabel}
            {" · "}
            {row.recipientsLabel}
          </p>
        </div>
        <MailApprovalStatusBadge status={row.status} />
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs crm-text-secondary">
        <span className="shrink-0 whitespace-nowrap">
          {formatHongKongDateTime(row.submittedAt)}
        </span>
        <span className="shrink-0">·</span>
        <span className="shrink-0 whitespace-nowrap">
          {t(resolveComposeModeLabelKey(composeMode))}
        </span>
      </div>
    </button>
  );
}

export function MailApprovalList({
  className,
  composeModesByApprovalId,
}: {
  className?: string;
  composeModesByApprovalId?: Map<string, string>;
}) {
  const { t } = useTranslation();
  const approvalWorkspace = useOptionalMailApprovalWorkspace();

  if (!approvalWorkspace) {
    return null;
  }

  const {
    rows,
    selectedApprovalId,
    isLoadingList,
    listError,
    loadApprovals,
    selectApproval,
  } = approvalWorkspace;

  return (
    <div className={cn("mail-approval-list flex min-h-0 min-w-0 flex-col", className)}>
      <div className="mail-list-toolbar shrink-0 border-b crm-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs font-medium crm-text-secondary">
            {t("mail.approval.queueCount", { count: String(rows.length) })}
          </p>
          <button
            type="button"
            onClick={() => void loadApprovals()}
            className="mail-list-toolbar-btn flex h-7 w-7 items-center justify-center rounded-md crm-text-secondary"
            aria-label={t("mail.list.refresh")}
            title={t("mail.list.refresh")}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoadingList && rows.length === 0 ? (
          <p className="px-3 py-6 text-sm crm-text-secondary">{t("common.loading")}</p>
        ) : null}
        {listError ? (
          <p className="px-3 py-6 text-sm text-red-600 dark:text-red-400">{listError}</p>
        ) : null}
        {!isLoadingList && !listError && rows.length === 0 ? (
          <p className="px-3 py-6 text-sm crm-text-secondary">
            {t("mail.approval.queueEmpty")}
          </p>
        ) : null}
        {rows.map((row) => (
          <ApprovalQueueRow
            key={row.id}
            row={row}
            composeMode={composeModesByApprovalId?.get(row.id)}
            active={selectedApprovalId === row.id}
            onSelect={() => void selectApproval(row.id)}
          />
        ))}
      </div>
    </div>
  );
}
