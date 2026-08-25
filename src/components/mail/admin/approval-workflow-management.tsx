"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/form";
import { PageIntro } from "@/components/ui/page-intro";
import {
  DataTable,
  TableBody,
  TableHead,
  TableShell,
  Td,
  Th,
  Tr,
} from "@/components/ui/table";
import { useTranslation } from "@/i18n/provider";
import {
  fetchAdminUsersForMailAccess,
  fetchApproval,
  fetchApprovals,
  fetchOutboundRevision,
  postApprovalApprove,
  postApprovalReturn,
} from "@/lib/mail/client/api";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import {
  buildApprovalWorkflowRows,
  canReviewApprovals,
  canViewApprovalWorkflow,
  isRejectReasonValid,
  resolveApprovalWorkflowRowActions,
  sortApprovalEvents,
  type ApprovalApiItem,
  type ApprovalStatus,
  type ApprovalWorkflowRow,
  type ApprovalWorkflowScope,
  type OutboundRevisionApiItem,
} from "@/lib/mail/client/approval-workflow-management";
import { formatHongKongDateTime } from "@/lib/timezone";
import {
  MailAdminEmptyState,
  MailAdminErrorState,
  MailAdminLoadingState,
  MAIL_ADMIN_CARD_STACK_CLASS,
  MAIL_ADMIN_SECTION_CLASS,
} from "./mail-admin-states";

import { MailApprovalStatusBadge } from "@/components/mail/shared/mail-approval-status-badge";

function ApprovalHistoryPanel({ row }: { row: ApprovalWorkflowRow }) {
  const { t } = useTranslation();
  const events = sortApprovalEvents(row.events);

  if (events.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border crm-border px-3 py-3">
      <p className="text-sm font-medium crm-text">
        {t("mail.adminCenter.approval.historyTitle")}
      </p>
      <ul className="mt-2 space-y-2">
        {events.map((event) => (
          <li key={event.id} className="text-sm crm-text-secondary">
            <span className="font-medium crm-text">
              {t(`mail.adminCenter.approval.event.${event.eventType}`)}
            </span>
            {" · "}
            {formatHongKongDateTime(event.createdAt)}
            {event.note ? (
              <p className="mt-1 whitespace-pre-wrap crm-text">{event.note}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ApprovalRejectPanel({
  pending,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");

  return (
    <div className="rounded-lg border crm-border px-3 py-3">
      <Label htmlFor="approval-reject-reason">
        {t("mail.adminCenter.approval.rejectReasonLabel")}
      </Label>
      <Textarea
        id="approval-reject-reason"
        className="mt-1 min-h-24"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder={t("mail.adminCenter.approval.rejectReasonPlaceholder")}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={pending || !isRejectReasonValid(reason)}
          onClick={() => onSubmit(reason.trim())}
        >
          {t("mail.adminCenter.approval.rejectAction")}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

function ApprovalRowActions({
  row,
  canReview,
  pending,
  rejecting,
  onApprove,
  onStartReject,
  onCancelReject,
  onSubmitReject,
}: {
  row: ApprovalWorkflowRow;
  canReview: boolean;
  pending: boolean;
  rejecting: boolean;
  onApprove: (approvalId: string) => void;
  onStartReject: (approvalId: string) => void;
  onCancelReject: () => void;
  onSubmitReject: (approvalId: string, reason: string) => void;
}) {
  const { t } = useTranslation();
  const actions = resolveApprovalWorkflowRowActions(row, canReview);

  if (rejecting) {
    return (
      <ApprovalRejectPanel
        pending={pending}
        onCancel={onCancelReject}
        onSubmit={(reason) => onSubmitReject(row.id, reason)}
      />
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {actions.showApprove ? (
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => onApprove(row.id)}
        >
          {t("mail.adminCenter.approval.approveAction")}
        </Button>
      ) : null}
      {actions.showReject ? (
        <Button
          type="button"
          size="sm"
          variant="danger"
          disabled={pending}
          onClick={() => onStartReject(row.id)}
        >
          {t("mail.adminCenter.approval.rejectAction")}
        </Button>
      ) : null}
    </div>
  );
}

function ApprovalMobileCard({
  row,
  canReview,
  pending,
  rejecting,
  expandedHistory,
  onToggleHistory,
  onApprove,
  onStartReject,
  onCancelReject,
  onSubmitReject,
}: {
  row: ApprovalWorkflowRow;
  canReview: boolean;
  pending: boolean;
  rejecting: boolean;
  expandedHistory: boolean;
  onToggleHistory: (approvalId: string) => void;
  onApprove: (approvalId: string) => void;
  onStartReject: (approvalId: string) => void;
  onCancelReject: () => void;
  onSubmitReject: (approvalId: string, reason: string) => void;
}) {
  const { t } = useTranslation();
  const actions = resolveApprovalWorkflowRowActions(row, canReview);

  return (
    <Card padding className="space-y-3 p-4 md:p-6">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium crm-text">{row.subject}</p>
        <p className="truncate text-sm crm-text-secondary">{row.senderLabel}</p>
      </div>
      <div className="space-y-1 text-sm crm-text-secondary">
        <p>
          {t("mail.adminCenter.approval.columns.recipients")}: {row.recipientsLabel}
        </p>
        <p>
          {t("mail.adminCenter.approval.columns.submitted")}:{" "}
          {formatHongKongDateTime(row.submittedAt)}
        </p>
        {canReview ? (
          <p>
            {t("mail.adminCenter.approval.columns.submitter")}: {row.submitterLabel}
          </p>
        ) : null}
        {row.approverLabel !== "—" ? (
          <p>
            {t("mail.adminCenter.approval.columns.approver")}: {row.approverLabel}
          </p>
        ) : null}
      </div>
      <MailApprovalStatusBadge status={row.status} />
      {row.returnReason ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          <p className="font-medium">{t("mail.adminCenter.approval.returnReasonTitle")}</p>
          <p className="mt-1 whitespace-pre-wrap">{row.returnReason}</p>
        </div>
      ) : null}
      <ApprovalRowActions
        row={row}
        canReview={canReview}
        pending={pending}
        rejecting={rejecting}
        onApprove={onApprove}
        onStartReject={onStartReject}
        onCancelReject={onCancelReject}
        onSubmitReject={onSubmitReject}
      />
      {actions.showHistory ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => onToggleHistory(row.id)}
          >
            {expandedHistory
              ? t("mail.adminCenter.approval.hideHistory")
              : t("mail.adminCenter.approval.showHistory")}
          </Button>
          {expandedHistory ? <ApprovalHistoryPanel row={row} /> : null}
        </>
      ) : null}
    </Card>
  );
}

async function enrichApprovalsWithEvents(
  approvals: ApprovalApiItem[],
  includeEvents: boolean,
): Promise<ApprovalApiItem[]> {
  if (!includeEvents) {
    return approvals;
  }
  const details = await Promise.all(approvals.map((approval) => fetchApproval(approval.id)));
  return details.flatMap((result, index) => {
    if (!result.ok) {
      return [approvals[index]!];
    }
    return [result.item];
  });
}

async function loadRevisionsById(
  revisionIds: string[],
): Promise<Map<string, OutboundRevisionApiItem>> {
  const revisionsById = new Map<string, OutboundRevisionApiItem>();
  const results = await Promise.all(
    revisionIds.map((revisionId) => fetchOutboundRevision(revisionId)),
  );
  for (const result of results) {
    if (result.ok) {
      revisionsById.set(result.item.id, result.item);
    }
  }
  return revisionsById;
}

export function ApprovalWorkflowManagement() {
  const { t } = useTranslation();
  const { capabilities } = useMailSession();
  const canView = canViewApprovalWorkflow(capabilities);
  const canReview = canReviewApprovals(capabilities);

  const [scope, setScope] = useState<ApprovalWorkflowScope>(
    canReview ? "reviewer" : "author",
  );
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | "all">(
    canReview ? "pending" : "all",
  );
  const [rows, setRows] = useState<ApprovalWorkflowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingApprovalId, setPendingApprovalId] = useState<string | null>(null);
  const [rejectingApprovalId, setRejectingApprovalId] = useState<string | null>(null);
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Set<string>>(
    () => new Set(),
  );

  const effectiveScope = useMemo(() => {
    if (scope === "reviewer" && !canReview) {
      return "author";
    }
    return scope;
  }, [canReview, scope]);

  const load = useCallback(async () => {
    if (!canView) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let approvals: ApprovalApiItem[] = [];
      if (effectiveScope === "reviewer" && statusFilter === "all") {
        const statuses: ApprovalStatus[] = [
          "pending",
          "returned",
          "approved",
          "withdrawn",
        ];
        const results = await Promise.all(
          statuses.map((status) => fetchApprovals({ scope: "reviewer", status })),
        );
        const failed = results.find((result) => !result.ok);
        if (failed && !failed.ok) {
          setRows([]);
          setError(failed.error);
          return;
        }
        const merged = new Map<string, ApprovalApiItem>();
        for (const result of results) {
          if (result.ok) {
            for (const item of result.items) {
              merged.set(item.id, item);
            }
          }
        }
        approvals = [...merged.values()].sort((left, right) =>
          right.requestedAt.localeCompare(left.requestedAt),
        );
      } else {
        const listResult = await fetchApprovals({
          scope: effectiveScope,
          status: statusFilter === "all" ? undefined : statusFilter,
        });
        if (!listResult.ok) {
          setRows([]);
          setError(listResult.error);
          return;
        }
        approvals = listResult.items;
      }

      const includeEvents = effectiveScope === "author";
      const enrichedApprovals = await enrichApprovalsWithEvents(
        approvals,
        includeEvents,
      );
      const revisionIds = [
        ...new Set(enrichedApprovals.map((approval) => approval.currentRevisionId)),
      ];
      const [revisionsById, usersResult] = await Promise.all([
        loadRevisionsById(revisionIds),
        fetchAdminUsersForMailAccess(),
      ]);
      const users = usersResult.ok ? usersResult.items : [];
      setRows(buildApprovalWorkflowRows(enrichedApprovals, revisionsById, users));
    } catch {
      setRows([]);
      setError(t("common.networkError"));
    } finally {
      setLoading(false);
    }
  }, [canView, effectiveScope, statusFilter, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleApprove(approvalId: string) {
    const row = rows.find((entry) => entry.id === approvalId);
    if (!row || !canReview) return;

    setPendingApprovalId(approvalId);
    setActionMessage(null);
    try {
      const result = await postApprovalApprove(approvalId, row.workflowVersion);
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      setActionMessage(t("mail.adminCenter.approval.approveSuccess"));
      setRejectingApprovalId(null);
      await load();
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setPendingApprovalId(null);
    }
  }

  async function handleReject(approvalId: string, reason: string) {
    const row = rows.find((entry) => entry.id === approvalId);
    if (!row || !canReview || !isRejectReasonValid(reason)) return;

    setPendingApprovalId(approvalId);
    setActionMessage(null);
    try {
      const result = await postApprovalReturn(approvalId, {
        expectedWorkflowVersion: row.workflowVersion,
        note: reason,
      });
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      setActionMessage(t("mail.adminCenter.approval.rejectSuccess"));
      setRejectingApprovalId(null);
      await load();
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setPendingApprovalId(null);
    }
  }

  function toggleHistory(approvalId: string) {
    setExpandedHistoryIds((current) => {
      const next = new Set(current);
      if (next.has(approvalId)) {
        next.delete(approvalId);
      } else {
        next.add(approvalId);
      }
      return next;
    });
  }

  if (!canView) {
    return (
      <div className={MAIL_ADMIN_SECTION_CLASS}>
        <PageIntro
          title={t("mail.adminCenter.sections.approval")}
          description={t("mail.adminCenter.descriptions.approval")}
        />
        <MailAdminEmptyState message={t("mail.adminCenter.approval.noPermission")} />
      </div>
    );
  }

  return (
    <div className={MAIL_ADMIN_SECTION_CLASS}>
      <PageIntro
        title={t("mail.adminCenter.sections.approval")}
        description={t("mail.adminCenter.descriptions.approval")}
      />

      {actionMessage ? (
        <p className="text-sm crm-text" role="status">
          {actionMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        {canReview ? (
          <div>
            <Label htmlFor="approval-scope">{t("mail.adminCenter.approval.scopeLabel")}</Label>
            <select
              id="approval-scope"
              className="mt-1 rounded-md border crm-border bg-transparent px-3 py-2 text-sm crm-text"
              value={scope}
              onChange={(event) =>
                setScope(event.target.value as ApprovalWorkflowScope)
              }
            >
              <option value="reviewer">
                {t("mail.adminCenter.approval.scopeReviewer")}
              </option>
              <option value="author">
                {t("mail.adminCenter.approval.scopeAuthor")}
              </option>
            </select>
          </div>
        ) : null}
        <div>
          <Label htmlFor="approval-status-filter">
            {t("mail.adminCenter.approval.statusFilterLabel")}
          </Label>
          <select
            id="approval-status-filter"
            className="mt-1 rounded-md border crm-border bg-transparent px-3 py-2 text-sm crm-text"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as ApprovalStatus | "all")
            }
          >
            <option value="all">{t("mail.adminCenter.approval.statusAll")}</option>
            <option value="pending">{t("mail.adminCenter.approval.status.pending")}</option>
            <option value="returned">{t("mail.adminCenter.approval.status.returned")}</option>
            <option value="approved">{t("mail.adminCenter.approval.status.approved")}</option>
            <option value="withdrawn">{t("mail.adminCenter.approval.status.withdrawn")}</option>
          </select>
        </div>
        <Button type="button" variant="secondary" disabled={loading} onClick={() => void load()}>
          {t("mail.adminCenter.approval.refresh")}
        </Button>
      </div>

      {loading ? (
        <MailAdminLoadingState />
      ) : error ? (
        <MailAdminErrorState message={error} onRetry={() => void load()} />
      ) : rows.length === 0 ? (
        <MailAdminEmptyState message={t("mail.adminCenter.approval.empty")} />
      ) : (
        <div className={MAIL_ADMIN_CARD_STACK_CLASS}>
          <Card padding className="p-4 md:p-6">
            <div className="hidden md:block">
              <TableShell>
                <DataTable>
                  <TableHead>
                    <Tr>
                      <Th>{t("mail.adminCenter.approval.columns.sender")}</Th>
                      <Th>{t("mail.adminCenter.approval.columns.recipients")}</Th>
                      <Th>{t("mail.adminCenter.approval.columns.subject")}</Th>
                      <Th>{t("mail.adminCenter.approval.columns.status")}</Th>
                      <Th>{t("mail.adminCenter.approval.columns.submitted")}</Th>
                      {effectiveScope === "reviewer" ? (
                        <Th>{t("mail.adminCenter.approval.columns.submitter")}</Th>
                      ) : null}
                      <Th>{t("mail.adminCenter.approval.columns.approver")}</Th>
                      <Th>{t("mail.adminCenter.approval.columns.actions")}</Th>
                    </Tr>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <Tr key={row.id}>
                        <Td>{row.senderLabel}</Td>
                        <Td className="max-w-[12rem] truncate">{row.recipientsLabel}</Td>
                        <Td className="max-w-[14rem] truncate">{row.subject}</Td>
                        <Td>
                          <MailApprovalStatusBadge status={row.status} />
                        </Td>
                        <Td>{formatHongKongDateTime(row.submittedAt)}</Td>
                        {effectiveScope === "reviewer" ? (
                          <Td>{row.submitterLabel}</Td>
                        ) : null}
                        <Td>{row.approverLabel}</Td>
                        <Td className="min-w-[12rem]">
                          {row.returnReason && effectiveScope === "author" ? (
                            <p className="mb-2 text-xs text-red-600 dark:text-red-400">
                              {row.returnReason}
                            </p>
                          ) : null}
                          <ApprovalRowActions
                            row={row}
                            canReview={canReview && effectiveScope === "reviewer"}
                            pending={pendingApprovalId === row.id}
                            rejecting={rejectingApprovalId === row.id}
                            onApprove={(approvalId) => void handleApprove(approvalId)}
                            onStartReject={setRejectingApprovalId}
                            onCancelReject={() => setRejectingApprovalId(null)}
                            onSubmitReject={(approvalId, reason) =>
                              void handleReject(approvalId, reason)
                            }
                          />
                        </Td>
                      </Tr>
                    ))}
                  </TableBody>
                </DataTable>
              </TableShell>
            </div>

            <div className="space-y-3 md:hidden">
              {rows.map((row) => (
                <ApprovalMobileCard
                  key={row.id}
                  row={row}
                  canReview={canReview && effectiveScope === "reviewer"}
                  pending={pendingApprovalId === row.id}
                  rejecting={rejectingApprovalId === row.id}
                  expandedHistory={expandedHistoryIds.has(row.id)}
                  onToggleHistory={toggleHistory}
                  onApprove={(approvalId) => void handleApprove(approvalId)}
                  onStartReject={setRejectingApprovalId}
                  onCancelReject={() => setRejectingApprovalId(null)}
                  onSubmitReject={(approvalId, reason) =>
                    void handleReject(approvalId, reason)
                  }
                />
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
