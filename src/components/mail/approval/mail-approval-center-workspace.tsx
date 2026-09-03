"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import type { ApprovalHistoryFilter } from "@/lib/mail/client/approval-workflow-management";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import { useMailApprovalWorkspace } from "@/lib/mail/client/mail-approval-workspace-context";
import { MailApprovalDetailPane } from "./mail-approval-detail-pane";
import { MailApprovalList } from "./mail-approval-list";

type ApprovalCenterTab = "pending" | "history";

function ApprovalCenterTabs({
  activeTab,
  onChange,
}: {
  activeTab: ApprovalCenterTab;
  onChange: (tab: ApprovalCenterTab) => void;
}) {
  const { t } = useTranslation();
  const tabs: Array<{ id: ApprovalCenterTab; label: string }> = [
    { id: "pending", label: t("mail.approvalCenter.pendingTab") },
    { id: "history", label: t("mail.approvalCenter.historyTab") },
  ];

  return (
    <div className="flex shrink-0 gap-1 border-b crm-border px-3 pt-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "min-h-9 border-b-2 px-2 text-sm font-medium transition-colors",
            activeTab === tab.id
              ? "border-[var(--color-crm-primary)] crm-text"
              : "border-transparent crm-text-secondary hover:crm-text",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function MailApprovalCenterWorkspace({
  mobile,
  onClose,
}: {
  mobile: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { capabilities } = useMailSession();
  const approvalWorkspace = useMailApprovalWorkspace();
  const { historyLoaded, loadApprovals, pendingLoaded } = approvalWorkspace;
  const [activeTab, setActiveTab] = useState<ApprovalCenterTab>("pending");
  const [historyFilter, setHistoryFilter] =
    useState<ApprovalHistoryFilter>("all");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  useEffect(() => {
    if (!pendingLoaded) {
      void loadApprovals({ dataset: "pending", force: false });
    }
    if (!historyLoaded) {
      const timer = window.setTimeout(() => {
        void loadApprovals({ dataset: "history", force: false });
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [historyLoaded, loadApprovals, pendingLoaded]);

  function changeTab(tab: ApprovalCenterTab) {
    setActiveTab(tab);
    approvalWorkspace.clearSelection();
    setMobileDetailOpen(false);
    void loadApprovals({
      dataset: tab,
      force: false,
    });
  }

  function closeCenter() {
    approvalWorkspace.clearSelection();
    onClose();
  }

  const list = (
    <MailApprovalList
      className="min-h-0 flex-1"
      mode={activeTab}
      historyFilter={historyFilter}
      onItemSelected={() => setMobileDetailOpen(true)}
    />
  );

  const detail = (
    <MailApprovalDetailPane className="min-h-0 flex-1" />
  );

  if (!capabilities.approvalReviewManagement) {
    return null;
  }

  if (mobile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--color-crm-bg)]">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b crm-border px-3 py-2">
          {mobileDetailOpen ? (
            <button
              type="button"
              onClick={() => {
                approvalWorkspace.clearSelection();
                setMobileDetailOpen(false);
              }}
              className="flex min-h-9 items-center gap-1 text-sm crm-text"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              {t("mail.approvalCenter.backToList")}
            </button>
          ) : (
            <h2 className="truncate text-sm font-semibold crm-text">
              {t("mail.approvalCenter.title")}
            </h2>
          )}
          <button
            type="button"
            onClick={closeCenter}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {!mobileDetailOpen ? (
          <>
            <ApprovalCenterTabs activeTab={activeTab} onChange={changeTab} />
            {activeTab === "history" ? (
              <HistoryFilter value={historyFilter} onChange={setHistoryFilter} />
            ) : null}
            {list}
          </>
        ) : (
          detail
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--color-crm-bg)]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b crm-border px-4 py-2">
        <h2 className="truncate text-sm font-semibold crm-text">
          {t("mail.approvalCenter.title")}
        </h2>
        <button
          type="button"
          onClick={closeCenter}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]"
          aria-label={t("common.close")}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <ApprovalCenterTabs activeTab={activeTab} onChange={changeTab} />
      {activeTab === "history" ? (
        <HistoryFilter value={historyFilter} onChange={setHistoryFilter} />
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {list}
        <div className="hidden min-h-0 min-w-0 flex-1 border-l crm-border md:flex">
          {detail}
        </div>
      </div>
    </div>
  );
}

function HistoryFilter({
  value,
  onChange,
}: {
  value: ApprovalHistoryFilter;
  onChange: (value: ApprovalHistoryFilter) => void;
}) {
  const { t } = useTranslation();
  const filters: Array<{ id: ApprovalHistoryFilter; label: string }> = [
    { id: "all", label: t("mail.approvalCenter.filterAll") },
    { id: "approved", label: t("mail.approvalCenter.filterApproved") },
    { id: "rejected", label: t("mail.approvalCenter.filterRejected") },
  ];

  return (
    <div className="flex shrink-0 items-center gap-1 border-b crm-border px-3 py-2">
      {filters.map((filter) => (
        <button
          key={filter.id}
          type="button"
          aria-pressed={value === filter.id}
          onClick={() => onChange(filter.id)}
          className={cn(
            "rounded-full px-2.5 py-1 text-xs transition-colors",
            value === filter.id
              ? "bg-[var(--color-crm-bg-muted)] font-medium crm-text"
              : "crm-text-secondary hover:bg-[var(--color-crm-bg-muted)] hover:crm-text",
          )}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}
