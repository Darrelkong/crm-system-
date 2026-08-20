"use client";

import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { useMailWorkspaceLayout } from "@/lib/mail/prototype/use-mail-workspace-layout";
import { useMailPaneWidths } from "@/lib/mail/prototype/use-mail-pane-widths";
import { MailMailboxesPane } from "./mail-mailboxes-pane";
import { MailPaneResizer } from "./mail-pane-resizer";
import { MailMessageList } from "./mail-message-list";
import { MailMessageDetail } from "./mail-message-detail";
import { MailSendErrorBadge } from "./mail-send-error-badge";
import { MailCompose, type ComposeDraft } from "./mail-compose";

type StackPane = "list" | "detail";

export function MailDesktopWorkspace({
  workspaceRef,
  composeOpen,
  composeExpanded,
  composeKey,
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
}: {
  workspaceRef: React.RefObject<HTMLDivElement | null>;
  composeOpen: boolean;
  composeExpanded: boolean;
  composeKey: number;
  onOpenCompose: (initial?: Partial<ComposeDraft>) => void;
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
}) {
  const { t } = useTranslation();
  const layoutMode = useMailWorkspaceLayout(workspaceRef);
  const [containerWidth, setContainerWidth] = useState(1200);
  const [stackPane, setStackPane] = useState<StackPane>("list");
  const [settingsOpen, setSettingsOpen] = useState(false);

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
  } = useMailPaneWidths(containerWidth, layoutMode);

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

  return (
    <div
      className={cn(
        "mail-desktop-workspace relative hidden min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:flex",
      )}
      data-layout={layoutMode}
      data-columns={readingPaneFits ? "three" : "compact"}
    >
      <div className="flex shrink-0 items-center justify-end border-b crm-border px-3 py-1">
        <MailSendErrorBadge />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div
          className="min-h-0 shrink-0 overflow-hidden border-r crm-border"
          style={{ width: mailboxesWidth }}
        >
          <MailMailboxesPane
            onCompose={() => onOpenCompose()}
            settingsOpen={settingsOpen}
            onToggleSettings={() => setSettingsOpen((v) => !v)}
            onCloseSettings={() => setSettingsOpen(false)}
            onRefresh={() => {}}
          />
        </div>

        <MailPaneResizer
          onResize={(delta) => setMailboxesWidth(mailboxesWidth + delta)}
          onDoubleClickReset={resetMailboxesWidth}
          style={{ width: resizerWidth }}
        />

        {showReadingPane ? (
          <>
            {!messageListCollapsed && (
              <>
                <div
                  className="flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-r crm-border"
                  style={{ width: listWidth }}
                >
                  <MailMessageList className="flex min-h-0 min-w-0 flex-1 flex-col" />
                </div>
                <MailPaneResizer
                  onResize={(delta) => setListWidth(listWidth + delta)}
                  onResizeEnd={finishListResize}
                  onDoubleClickReset={toggleMessageListCollapsed}
                  style={{ width: resizerWidth }}
                />
              </>
            )}
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <MailMessageDetail
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
              />
            </div>
          </>
        ) : stackPane === "list" ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <MailMessageList
              className="flex min-h-0 min-w-0 flex-1 flex-col"
              onMessageSelect={handleSelectMessage}
            />
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
              <MailMessageDetail
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
                ? "absolute bottom-0 right-0 top-0 rounded-none border-0 border-l"
                : "max-h-[min(80%,calc(100%-2rem))] w-[min(720px,92%)] rounded-lg shadow-md",
            )}
            style={
              composeExpanded
                ? { left: mailboxesWidth + resizerWidth }
                : undefined
            }
          >
            <MailCompose
              key={composeKey}
              variant="floating-desktop"
              expanded={composeExpanded}
              onClose={onCloseCompose}
              onToggleExpand={onToggleComposeExpand}
            />
          </div>
        </div>
      )}
    </div>
  );
}
