"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { useOptionalMailWorkspace } from "@/lib/mail/client/mail-workspace-context";
import { useMailWorkspaceLayout } from "@/lib/mail/prototype/use-mail-workspace-layout";
import { useMailPaneWidths } from "@/lib/mail/prototype/use-mail-pane-widths";
import { MailMailboxesPane } from "./mail-mailboxes-pane";
import { MailPaneResizer } from "./mail-pane-resizer";
import { MailMessageList } from "./mail-message-list";
import { MailReadingPane } from "./mail-reading-pane";
import { MailComposeEditor } from "@/components/mail/compose/mail-compose-editor";
import { MailComposeDesktopHost } from "@/components/mail/compose/mail-compose-desktop-host";
import type { ComposeInitialSeed } from "@/lib/mail/client/draft-management";
import type { MockComposeDraft } from "@/lib/mail/prototype/state";
import type { MailWorkspaceFolder } from "@/lib/mail/client/mail-read-types";
import type { SendOperationApiItem } from "@/lib/mail/client/approved-outbound-queue";

type StackPane = "list" | "detail";
type DesktopMailView = "list" | "message";

export function MailDesktopWorkspace({
  workspaceRef,
  composeOpen,
  composeExpanded,
  composeKey,
  composeSeed,
  mailFolder = "inbox",
  onOpenCompose,
  onCloseCompose,
  onAdminDirectQueued,
  onToggleComposeExpand,
  onComposeDraftPersisted,
  onReply,
  onReplyAll,
  onForward,
  onAdminEdit,
  onSelectMessage,
  replyGuard,
  onDismissReplyGuard,
  onProceedReplyGuard,
  onProductionSeedAction,
  composeSeedPending = false,
  showAdminEntry = false,
  onOpenAdminCenter,
  showApprovalEntry = false,
  approvalPendingCount = 0,
  onOpenApprovalCenter,
  showNotificationMailboxEntry = false,
  onOpenNotificationMailbox,
  adminCenterReturnFocusRef,
}: {
  workspaceRef: React.RefObject<HTMLDivElement | null>;
  composeOpen: boolean;
  composeExpanded: boolean;
  composeKey: number;
  composeSeed?: ComposeInitialSeed;
  mailFolder?: MailWorkspaceFolder;
  onOpenCompose: (initial?: Partial<MockComposeDraft> | ComposeInitialSeed) => void;
  onCloseCompose: () => void;
  onAdminDirectQueued?: (send: SendOperationApiItem) => void;
  onToggleComposeExpand: () => void;
  onComposeDraftPersisted?: () => void;
  onReply: (messageId: string) => void;
  onReplyAll: (messageId: string) => void;
  onForward: (messageId: string) => void;
  onAdminEdit: (messageId: string) => void;
  onSelectMessage: (id: string) => void;
  replyGuard?: { messageId: string; action: "reply" | "reply_all" | "forward" } | null;
  onDismissReplyGuard?: () => void;
  onProceedReplyGuard?: () => void;
  onProductionSeedAction?: (
    messageId: string,
    mode: "reply" | "reply_all" | "forward",
  ) => void;
  composeSeedPending?: boolean;
  showAdminEntry?: boolean;
  onOpenAdminCenter?: () => void;
  showApprovalEntry?: boolean;
  approvalPendingCount?: number;
  onOpenApprovalCenter?: () => void;
  showNotificationMailboxEntry?: boolean;
  onOpenNotificationMailbox?: () => void;
  adminCenterReturnFocusRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation();
  const workspace = useOptionalMailWorkspace();
  const layoutMode = useMailWorkspaceLayout(workspaceRef);
  const [containerWidth, setContainerWidth] = useState(1200);
  const [stackPane, setStackPane] = useState<StackPane>("list");
  const [desktopMailView, setDesktopMailView] =
    useState<DesktopMailView>("list");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mailboxSidebarCollapsed, setMailboxSidebarCollapsed] = useState(false);
  const mailContentSnapshotRef = useRef<{
    desktopMailView: DesktopMailView;
    stackPane: StackPane;
  } | null>(null);
  const mainContentPaneRef = useRef<HTMLDivElement>(null);

  const {
    mailboxesWidth,
    listWidth,
    messageListCollapsed,
    setMailboxesWidth,
    setListWidth,
    finishListResize,
    restoreMessageList,
    toggleMessageListCollapsed,
    resetMailboxesWidth,
    readingPaneFits,
    resizerWidth,
    effectiveMailboxWidth,
  } = useMailPaneWidths(containerWidth, layoutMode, {
    mailboxSidebarCollapsed,
  });

  const tabletLayout = layoutMode === "medium";
  const showMailboxSidebar = !mailboxSidebarCollapsed;
  const showEmbeddedCompose = composeOpen && composeExpanded;
  const wideDesktopListMode =
    readingPaneFits && desktopMailView === "list" && !showEmbeddedCompose;
  const wideDesktopMessageMode =
    readingPaneFits && desktopMailView === "message" && !showEmbeddedCompose;

  useEffect(() => {
    if (layoutMode === "medium") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- preserve the existing responsive layout transition
      setMailboxSidebarCollapsed(true);
    } else if (layoutMode === "wide") {
      setMailboxSidebarCollapsed(false);
    }
  }, [layoutMode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset reading focus when the selected folder changes
    setStackPane("list");
    setDesktopMailView("list");
  }, [workspace?.selectedFolder]);

  useEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [workspaceRef]);

  function handleSelectMessage(id: string) {
    onSelectMessage(id);
    if (mailFolder === "drafts") {
      return;
    }
    if (readingPaneFits) {
      setDesktopMailView("message");
    } else {
      setStackPane("detail");
    }
  }

  function handleApprovalItemSelect() {
    if (readingPaneFits) {
      setDesktopMailView("message");
    } else {
      setStackPane("detail");
    }
  }

  function isDesktopReadingFocus(): boolean {
    if (showEmbeddedCompose) {
      return false;
    }
    if (readingPaneFits) {
      return desktopMailView === "message";
    }
    return stackPane === "detail";
  }

  function returnToFolderList() {
    if (readingPaneFits) {
      setDesktopMailView("list");
    } else {
      setStackPane("list");
    }
    workspace?.clearReadingSelection();
  }

  function handleDesktopFolderSelect(folder: MailWorkspaceFolder) {
    if (!workspace) {
      return;
    }
    const sameFolder = workspace.selectedFolder === folder;
    const inReadingFocus = isDesktopReadingFocus();

    if (sameFolder) {
      if (inReadingFocus) {
        returnToFolderList();
      }
      return;
    }

    if (inReadingFocus) {
      returnToFolderList();
    }
    void workspace.selectFolder(folder);
  }

  function handleBackToMessageList() {
    returnToFolderList();
  }

  function handleToggleComposeExpand() {
    if (!composeExpanded) {
      mailContentSnapshotRef.current = {
        desktopMailView,
        stackPane,
      };
    } else if (mailContentSnapshotRef.current) {
      setDesktopMailView(mailContentSnapshotRef.current.desktopMailView);
      setStackPane(mailContentSnapshotRef.current.stackPane);
      mailContentSnapshotRef.current = null;
    }
    onToggleComposeExpand();
  }

  function handleCloseCompose() {
    if (mailContentSnapshotRef.current) {
      setDesktopMailView(mailContentSnapshotRef.current.desktopMailView);
      setStackPane(mailContentSnapshotRef.current.stackPane);
      mailContentSnapshotRef.current = null;
    }
    onCloseCompose();
  }

  const readingPaneProps = {
    onReply,
    onReplyAll,
    onForward,
    onAdminEdit,
    variant: "desktop" as const,
    messageListCollapsed,
    onShowMessageList: restoreMessageList,
    replyGuard,
    onDismissReplyGuard,
    onProceedReplyGuard,
    onProductionSeedAction,
    composeSeedPending,
  };

  const activeDraftId = composeOpen ? composeSeed?.draftId : undefined;

  const composeEditor = composeOpen ? (
    <MailComposeEditor
      key={composeSeed?.draftId ?? `new-${composeKey}`}
      seed={composeSeed}
      variant="floating-desktop"
      expanded={composeExpanded}
      onClose={handleCloseCompose}
      onAdminDirectQueued={onAdminDirectQueued}
      onToggleExpand={handleToggleComposeExpand}
      onSubmitted={handleCloseCompose}
      onDraftPersisted={onComposeDraftPersisted}
    />
  ) : null;

  const mailContentPane = readingPaneFits ? (
    wideDesktopListMode ? (
      <div className="mail-list-column flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-crm-bg)]">
        <MailMessageList
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          onMessageSelect={handleSelectMessage}
          onApprovalItemSelect={handleApprovalItemSelect}
          activeDraftId={activeDraftId}
        />
      </div>
    ) : wideDesktopMessageMode ? (
      <div className="mail-reading-column flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-crm-bg)]">
        <div className="flex shrink-0 items-center gap-2 border-b crm-border px-3 py-1.5">
          <button
            type="button"
            onClick={handleBackToMessageList}
            className="flex min-h-9 items-center gap-1 text-sm crm-text"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            {t("mail.backToMessageList")}
          </button>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <MailReadingPane {...readingPaneProps} />
        </div>
      </div>
    ) : null
  ) : stackPane === "list" ? (
    <div className="mail-list-column flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-crm-bg)]">
      <MailMessageList
        className="flex min-h-0 min-w-0 flex-1 flex-col"
        onMessageSelect={handleSelectMessage}
        onApprovalItemSelect={handleApprovalItemSelect}
        activeDraftId={activeDraftId}
      />
    </div>
  ) : (
    <div className="mail-reading-column flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-crm-bg)]">
      <div className="flex shrink-0 items-center gap-2 border-b crm-border px-3 py-1.5">
        <button
          type="button"
          onClick={handleBackToMessageList}
          className="flex min-h-9 items-center gap-1 text-sm crm-text"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          {t("mail.backToMessageList")}
        </button>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <MailReadingPane {...readingPaneProps} />
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "mail-desktop-workspace relative hidden min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:flex",
      )}
      data-layout={layoutMode}
      data-desktop-mail-view={
        showEmbeddedCompose
          ? "compose-embedded"
          : readingPaneFits
            ? desktopMailView
            : stackPane
      }
      data-columns={
        showEmbeddedCompose
          ? "compose-embedded"
          : wideDesktopListMode
            ? showMailboxSidebar
              ? "list"
              : "list-compact"
            : wideDesktopMessageMode
              ? "reading-focus"
              : "compact"
      }
    >
      <div className="mail-workspace-body flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {!showMailboxSidebar && (
          <div className="mail-mailbox-collapse-rail flex w-10 shrink-0 flex-col items-center border-r crm-border bg-[var(--color-crm-bg-muted)] py-2">
            <button
              type="button"
              onClick={() => setMailboxSidebarCollapsed(false)}
              className="mail-sidebar-icon-btn flex h-9 w-9 items-center justify-center rounded-lg crm-text-secondary"
              aria-label={t("mail.sidebar.expand")}
              title={t("mail.sidebar.expand")}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        )}

        {showMailboxSidebar && (
          <>
            <div
              className="mail-mailbox-column relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r crm-border"
              style={{ width: mailboxesWidth }}
            >
              {tabletLayout && (
                <button
                  type="button"
                  onClick={() => setMailboxSidebarCollapsed(true)}
                  className="mail-sidebar-icon-btn absolute right-1 top-1 z-10 flex h-7 w-7 items-center justify-center rounded-md crm-text-secondary"
                  aria-label={t("mail.sidebar.collapse")}
                  title={t("mail.sidebar.collapse")}
                >
                  <PanelLeftClose className="h-3.5 w-3.5" />
                </button>
              )}
              <MailMailboxesPane
                onCompose={() => onOpenCompose()}
                onFolderSelect={handleDesktopFolderSelect}
                settingsOpen={settingsOpen}
                onToggleSettings={() => setSettingsOpen((v) => !v)}
                onCloseSettings={() => setSettingsOpen(false)}
                onRefresh={() => {}}
                showAdminEntry={showAdminEntry}
                onOpenAdminCenter={onOpenAdminCenter}
                showApprovalEntry={showApprovalEntry}
                approvalPendingCount={approvalPendingCount}
                onOpenApprovalCenter={onOpenApprovalCenter}
                showNotificationMailboxEntry={showNotificationMailboxEntry}
                onOpenNotificationMailbox={onOpenNotificationMailbox}
                settingsReturnFocusRef={adminCenterReturnFocusRef}
              />
            </div>
            {!composeOpen ? (
              <MailPaneResizer
                onResize={(delta) => setMailboxesWidth(mailboxesWidth + delta)}
                onDoubleClickReset={resetMailboxesWidth}
                style={{ width: resizerWidth }}
              />
            ) : null}
          </>
        )}

        <div
          ref={mainContentPaneRef}
          className="mail-main-content-pane relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          data-mail-main-content-pane
        >
          {!showEmbeddedCompose ? mailContentPane : null}

          {composeOpen ? (
            <MailComposeDesktopHost
              mainContentPaneRef={mainContentPaneRef}
              expanded={composeExpanded}
            >
              {composeEditor}
            </MailComposeDesktopHost>
          ) : null}
        </div>
      </div>
    </div>
  );
}
