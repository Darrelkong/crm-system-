"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { useMailWorkspaceLayout } from "@/lib/mail/prototype/use-mail-workspace-layout";
import { useMailPaneWidths } from "@/lib/mail/prototype/use-mail-pane-widths";
import { MailMailboxesPane } from "./mail-mailboxes-pane";
import { MailPaneResizer } from "./mail-pane-resizer";
import { MailMessageList } from "./mail-message-list";
import { MailReadingPane } from "./mail-reading-pane";
import { MailComposeEditor } from "@/components/mail/compose/mail-compose-editor";
import type { ComposeInitialSeed } from "@/lib/mail/client/draft-management";
import type { MockComposeDraft } from "@/lib/mail/prototype/state";

type StackPane = "list" | "detail";

export function MailDesktopWorkspace({
  workspaceRef,
  composeOpen,
  composeExpanded,
  composeKey,
  composeSeed,
  onOpenCompose,
  onCloseCompose,
  onToggleComposeExpand,
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
  adminCenterReturnFocusRef,
}: {
  workspaceRef: React.RefObject<HTMLDivElement | null>;
  composeOpen: boolean;
  composeExpanded: boolean;
  composeKey: number;
  composeSeed?: ComposeInitialSeed;
  onOpenCompose: (initial?: Partial<MockComposeDraft> | ComposeInitialSeed) => void;
  onCloseCompose: () => void;
  onToggleComposeExpand: () => void;
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
  adminCenterReturnFocusRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation();
  const layoutMode = useMailWorkspaceLayout(workspaceRef);
  const [containerWidth, setContainerWidth] = useState(1200);
  const [stackPane, setStackPane] = useState<StackPane>("list");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mailboxSidebarCollapsed, setMailboxSidebarCollapsed] = useState(false);

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

  useEffect(() => {
    if (layoutMode === "medium") {
      setMailboxSidebarCollapsed(true);
    } else if (layoutMode === "wide") {
      setMailboxSidebarCollapsed(false);
    }
  }, [layoutMode]);

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
    if (!readingPaneFits) {
      setStackPane("detail");
    }
  }

  const showReadingPane = readingPaneFits && stackPane === "list";
  const composeExpandedLeft = showMailboxSidebar
    ? mailboxesWidth + resizerWidth
    : effectiveMailboxWidth;

  return (
    <div
      className={cn(
        "mail-desktop-workspace relative hidden min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:flex",
      )}
      data-layout={layoutMode}
      data-columns={
        showReadingPane
          ? showMailboxSidebar
            ? "three"
            : "two"
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
              className="mail-mailbox-column relative min-h-0 shrink-0 overflow-hidden border-r crm-border"
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
                settingsOpen={settingsOpen}
                onToggleSettings={() => setSettingsOpen((v) => !v)}
                onCloseSettings={() => setSettingsOpen(false)}
                onRefresh={() => {}}
                showAdminEntry={showAdminEntry}
                onOpenAdminCenter={onOpenAdminCenter}
                settingsReturnFocusRef={adminCenterReturnFocusRef}
              />
            </div>
            <MailPaneResizer
              onResize={(delta) => setMailboxesWidth(mailboxesWidth + delta)}
              onDoubleClickReset={resetMailboxesWidth}
              style={{ width: resizerWidth }}
            />
          </>
        )}

        {showReadingPane ? (
          <>
            {!messageListCollapsed && (
              <>
                <div
                  className="mail-list-column flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-r crm-border bg-[var(--color-crm-bg)]"
                  style={{ width: listWidth }}
                >
                  <MailMessageList
                    className="flex min-h-0 min-w-0 flex-1 flex-col"
                    onMessageSelect={handleSelectMessage}
                  />
                </div>
                <MailPaneResizer
                  onResize={(delta) => setListWidth(listWidth + delta)}
                  onResizeEnd={finishListResize}
                  onDoubleClickReset={toggleMessageListCollapsed}
                  style={{ width: resizerWidth }}
                />
              </>
            )}
            <div className="mail-reading-column min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--color-crm-bg)]">
              <MailReadingPane
                onReply={onReply}
                onReplyAll={onReplyAll}
                onForward={onForward}
                onAdminEdit={onAdminEdit}
                variant="desktop"
                messageListCollapsed={messageListCollapsed}
                onShowMessageList={restoreMessageList}
                replyGuard={replyGuard}
                onDismissReplyGuard={onDismissReplyGuard}
                onProceedReplyGuard={onProceedReplyGuard}
                onProductionSeedAction={onProductionSeedAction}
                composeSeedPending={composeSeedPending}
              />
            </div>
          </>
        ) : stackPane === "list" ? (
          <div className="mail-list-column flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-crm-bg)]">
            <MailMessageList
              className="flex min-h-0 min-w-0 flex-1 flex-col"
              onMessageSelect={handleSelectMessage}
            />
          </div>
        ) : (
          <div className="mail-reading-column flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-crm-bg)]">
            <div className="flex shrink-0 items-center gap-2 border-b crm-border px-3 py-1.5">
              <button
                type="button"
                onClick={() => setStackPane("list")}
                className="flex min-h-9 items-center gap-1 text-sm crm-text"
              >
                <ArrowLeft className="h-4 w-4 shrink-0" />
                {t("mail.compose.backToMail")}
              </button>
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <MailReadingPane
                onReply={onReply}
                onReplyAll={onReplyAll}
                onForward={onForward}
                onAdminEdit={onAdminEdit}
                variant="desktop"
                messageListCollapsed={messageListCollapsed}
                onShowMessageList={restoreMessageList}
                replyGuard={replyGuard}
                onDismissReplyGuard={onDismissReplyGuard}
                onProceedReplyGuard={onProceedReplyGuard}
                onProductionSeedAction={onProductionSeedAction}
                composeSeedPending={composeSeedPending}
              />
            </div>
          </div>
        )}
      </div>

      {composeOpen && (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-20",
            !composeExpanded && "flex items-center justify-center p-4",
          )}
        >
          <div
            className={cn(
              "mail-floating-compose pointer-events-auto flex min-h-0 flex-col overflow-hidden border crm-border bg-[var(--color-crm-bg)]",
              composeExpanded
                ? "absolute bottom-0 right-0 top-0 rounded-none border-0 border-l shadow-lg"
                : "max-h-[min(80%,calc(100%-2rem))] w-[min(720px,92%)] rounded-xl shadow-lg",
            )}
            style={
              composeExpanded
                ? { left: composeExpandedLeft }
                : undefined
            }
          >
            <MailComposeEditor
              key={composeKey}
              seed={composeSeed}
              variant="floating-desktop"
              expanded={composeExpanded}
              onClose={onCloseCompose}
              onToggleExpand={onToggleComposeExpand}
              onSubmitted={onCloseCompose}
            />
          </div>
        </div>
      )}
    </div>
  );
}
