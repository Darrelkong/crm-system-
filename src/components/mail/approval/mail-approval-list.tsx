"use client";

import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { MailApprovalStatusBadge } from "@/components/mail/shared/mail-approval-status-badge";
import { MailApprovalResultBadge } from "@/components/mail/shared/mail-approval-result-badge";
import { useOptionalMailApprovalWorkspace } from "@/lib/mail/client/mail-approval-workspace-context";
import {
  APPROVAL_HISTORY_STATUSES,
  filterApprovalHistoryRows,
  formatApprovalRequesterLabel,
  type ApprovalHistoryFilter,
  type ApprovalWorkflowRow,
} from "@/lib/mail/client/approval-workflow-management";
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
  history = false,
  onSelect,
}: {
  row: ApprovalWorkflowRow;
  composeMode?: string;
  active: boolean;
  history?: boolean;
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
            {history
              ? `${t("mail.approvalCenter.applicant")}: `
              : ""}
            {formatApprovalRequesterLabel(row.submitterLabel, t)}
            {" · "}
            {history
              ? `${t("mail.compose.to")}: ${row.recipientsLabel}`
              : row.recipientsLabel}
          </p>
          {history ? (
            <p className="mt-1 truncate text-xs crm-text-secondary">
              {t("mail.compose.from")}: {row.senderLabel}
            </p>
          ) : null}
        </div>
        {history ? (
          <MailApprovalResultBadge status={row.status} />
        ) : (
          <MailApprovalStatusBadge status={row.status} />
        )}
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs crm-text-secondary">
        <span className="shrink-0 whitespace-nowrap">
          {formatHongKongDateTime(row.submittedAt)}
        </span>
        <span className="shrink-0">·</span>
        {history ? (
          <>
            <span className="shrink-0 whitespace-nowrap">
              {t("mail.approvalCenter.reviewedAt")}:{" "}
              {row.reviewedAt
                ? formatHongKongDateTime(row.reviewedAt)
                : "—"}
            </span>
            <span className="shrink-0">·</span>
            <span className="min-w-0 truncate">
              {t("mail.approvalCenter.reviewer")}: {row.approverLabel}
            </span>
          </>
        ) : (
          <span className="shrink-0 whitespace-nowrap">
            {t(resolveComposeModeLabelKey(composeMode))}
          </span>
        )}
      </div>
    </button>
  );
}

export function MailApprovalList({
  className,
  composeModesByApprovalId,
  onItemSelected,
  mode = "pending",
  historyFilter = "all",
}: {
  className?: string;
  composeModesByApprovalId?: Map<string, string>;
  onItemSelected?: () => void;
  mode?: "pending" | "history";
  historyFilter?: ApprovalHistoryFilter;
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
    canReview,
  } = approvalWorkspace;
  const visibleRows =
    mode === "history"
      ? filterApprovalHistoryRows(rows, historyFilter)
      : rows;

  return (
    <div className={cn("mail-approval-list flex min-h-0 min-w-0 flex-col", className)}>
      <div className="mail-list-toolbar shrink-0 border-b crm-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs font-medium crm-text-secondary">
            {mode === "history"
              ? t("mail.approvalCenter.historyCount", {
                  count: String(visibleRows.length),
                })
              : canReview
                ? t("mail.approval.queueCount", { count: String(visibleRows.length) })
                : t("mail.approval.authorQueueCount", {
                    count: String(visibleRows.length),
                  })}
          </p>
          <button
            type="button"
            onClick={() =>
              void loadApprovals({
                statuses:
                  mode === "history"
                    ? APPROVAL_HISTORY_STATUSES
                    : ["pending"],
              })
            }
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
        {!isLoadingList && !listError && visibleRows.length === 0 ? (
          <p className="px-3 py-6 text-sm crm-text-secondary">
            {mode === "history"
              ? t("mail.approvalCenter.historyEmpty")
              : canReview
                ? t("mail.approval.queueEmpty")
                : t("mail.approval.authorQueueEmpty")}
          </p>
        ) : null}
        {visibleRows.map((row) => (
          <ApprovalQueueRow
            key={row.id}
            row={row}
            composeMode={composeModesByApprovalId?.get(row.id)}
            history={mode === "history"}
            active={selectedApprovalId === row.id}
            onSelect={() => {
              void selectApproval(row.id);
              onItemSelected?.();
            }}
          />
        ))}
      </div>
    </div>
  );
}
