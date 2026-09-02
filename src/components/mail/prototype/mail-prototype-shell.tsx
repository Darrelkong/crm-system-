"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/provider";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import { MailAdminCenterDrawer } from "@/components/mail/admin/mail-admin-center-drawer";
import { NotificationMailboxSelfServiceModal } from "@/components/mail/notification-mailbox-self-service-modal";
import { MailFolderActionRow } from "./mail-folder-action-row";
import { MailFolderPopover } from "./mail-folder-popover";
import { MailMessageList } from "./mail-message-list";
import { useIsProductionMailReadSource } from "@/lib/mail/client/mail-read-source-context";
import { useOptionalMailWorkspace } from "@/lib/mail/client/mail-workspace-context";
import { isProductionMailReadFolder } from "@/lib/mail/client/mail-workspace-ui-adapters";
import { MailReadingPane } from "./mail-reading-pane";
import { MailComposeEditor } from "@/components/mail/compose/mail-compose-editor";
import type { ComposeInitialSeed } from "@/lib/mail/client/draft-management";
import type { MockComposeDraft } from "@/lib/mail/prototype/state";
import { MailNoAccessState } from "./mail-no-access-state";
import { MailAdminOnlyShell } from "./mail-admin-only-shell";
import { MailProductionNoMailboxesState } from "./mail-production-no-mailboxes-state";
import { MailStaffAccessState } from "./mail-staff-access-state";
import { MailDebugControls } from "./mail-debug-controls";
import { MailDesktopWorkspace } from "./mail-desktop-workspace";
import { prefetchComposeContext } from "@/lib/mail/client/compose-context-cache";
import {
  buildForwardDraft,
  buildReplyAllDraft,
  buildReplyDraft,
} from "@/lib/mail/prototype/message-actions";
import {
  createComposeDraftFromMessage,
  createComposeSeedRequestGuard,
  resolveComposeDraftSeedErrorMessageKey,
} from "@/lib/mail/client/compose-draft-seed-client";
import type { MailWorkspaceFolder } from "@/lib/mail/client/mail-read-types";
import type { MailFolderId } from "@/lib/mail/prototype/types";
import type { ProductionComposeSeedAction } from "@/components/mail/prototype/mail-production-message-actions";
import {
  shouldWarnSharedReply,
} from "@/lib/mail/prototype/shared-mailbox";

type MobileView = "list" | "detail" | "compose";
type ReplyGuardAction = "reply" | "reply_all" | "forward";
type ReplyGuardState = { messageId: string; action: ReplyGuardAction } | null;

function prototypeFolderToWorkspaceFolder(
  folder: MailFolderId,
): MailWorkspaceFolder | undefined {
  if (folder === "drafts") return "drafts";
  if (folder === "pending_approval") return "pending_approval";
  if (folder === "inbox" || folder === "sent" || folder === "trash") return folder;
  return undefined;
}

function useMobileViewport() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
}

function normalizeRecipients(
  value?: string | string[],
): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function toComposeSeed(
  initial?: Partial<MockComposeDraft> | ComposeInitialSeed,
): ComposeInitialSeed | undefined {
  if (!initial) return undefined;
  return {
    draftId: "draftId" in initial ? initial.draftId : undefined,
    senderIdentityId:
      "senderIdentityId" in initial ? initial.senderIdentityId : undefined,
    mailboxId: "mailboxId" in initial ? initial.mailboxId : undefined,
    to: normalizeRecipients(initial.to),
    cc: normalizeRecipients(initial.cc),
    bcc: normalizeRecipients(initial.bcc),
    subject: initial.subject ?? "",
    bodyHtml:
      ("bodyHtml" in initial ? initial.bodyHtml : undefined) ??
      ("body" in initial ? initial.body : undefined) ??
      "",
  };
}

export function MailPrototypeShell({
  role: _role,
  dashboardHref = "/admin",
}: {
  role: "admin" | "staff";
  dashboardHref?: "/admin" | "/staff";
}) {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const isMobileViewport = useMobileViewport();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const folderTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileSettingsRef = useRef<HTMLButtonElement>(null);
  const desktopSettingsRef = useRef<HTMLButtonElement>(null);
  const customerHandledRef = useRef(false);
  const {
    loading: sessionLoading,
    error: sessionError,
    refresh: refreshMailSession,
    session,
    effectiveMailAccessEnabled,
    workspaceShellMode,
    canOpenAdminCenter,
  } = useMailSession();

  const isProduction = useIsProductionMailReadSource();
  const workspace = useOptionalMailWorkspace();

  const [adminCenterOpen, setAdminCenterOpen] = useState(false);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const [notificationMailboxOpen, setNotificationMailboxOpen] = useState(false);

  const {
    messages,
    selectedId,
    setSelectedId,
    activeFolder,
    toast,
    clearToast,
    openDraftMessage,
    openAdminEditApproval,
    currentTeamMemberId,
    openMessageFromNotification,
    showToast,
  } = useMailPrototype();

  const [mobileView, setMobileView] = useState<MobileView>("list");
  const [folderPopoverOpen, setFolderPopoverOpen] = useState(false);
  const [composeKey, setComposeKey] = useState(0);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeExpanded, setComposeExpanded] = useState(false);
  const [replyGuard, setReplyGuard] = useState<ReplyGuardState>(null);
  const [composeSeedPending, setComposeSeedPending] = useState(false);
  const composeSeedGuardRef = useRef(createComposeSeedRequestGuard());

  const [composeSeed, setComposeSeed] = useState<ComposeInitialSeed | undefined>(
    undefined,
  );

  function openCompose(initial?: Partial<MockComposeDraft> | ComposeInitialSeed) {
    const seed = toComposeSeed(initial);
    setComposeSeed(seed);
    if (!seed?.draftId) {
      setComposeKey((k) => k + 1);
    }
    if (isMobileViewport) {
      setMobileView("compose");
    } else {
      setComposeOpen(true);
      setComposeExpanded(false);
    }
  }

  function closeCompose() {
    if (isMobileViewport) {
      setMobileView(mobileView === "compose" ? "list" : mobileView);
    } else {
      setComposeOpen(false);
      setComposeExpanded(false);
    }
    setComposeSeed(undefined);
  }

  function handleComposeDraftPersisted() {
    if (workspace) {
      void workspace.refreshDrafts();
    }
  }

  const mailFolder =
    workspace?.selectedFolder ?? prototypeFolderToWorkspaceFolder(activeFolder);

  async function handleProductionComposeSeed(
    messageId: string,
    mode: ProductionComposeSeedAction,
  ) {
    if (!workspace || !isProductionMailReadFolder(workspace.selectedFolder)) return;
    const folder = workspace.selectedFolder;
    const guard = composeSeedGuardRef.current;
    if (guard.isPending()) return;

    const requestId = guard.begin();
    setComposeSeedPending(true);
    try {
      const result = await createComposeDraftFromMessage({
        messageId,
        mode,
        folder,
      });
      if (!guard.isCurrent(requestId)) {
        return;
      }
      if (!result.ok) {
        showToast(t(resolveComposeDraftSeedErrorMessageKey(result.status)));
        return;
      }
      openCompose({ draftId: result.item.id });
    } finally {
      guard.end(requestId);
      if (!guard.isPending()) {
        setComposeSeedPending(false);
      }
    }
  }

  function handleProductionSeedAction(
    messageId: string,
    mode: ProductionComposeSeedAction,
  ) {
    void handleProductionComposeSeed(messageId, mode);
  }

  function proceedReplyAction(guard: ReplyGuardState) {
    if (!guard) return;
    const msg = messages.find((m) => m.id === guard.messageId);
    if (!msg) return;
    if (guard.action === "reply") openCompose(buildReplyDraft(msg));
    else if (guard.action === "reply_all") openCompose(buildReplyAllDraft(msg));
    else openCompose(buildForwardDraft(msg));
    setReplyGuard(null);
  }

  function maybeGuardReply(
    messageId: string,
    action: ReplyGuardAction,
    proceed: () => void,
  ) {
    const msg = messages.find((m) => m.id === messageId);
    if (msg && shouldWarnSharedReply(msg, currentTeamMemberId)) {
      setReplyGuard({ messageId, action });
      return;
    }
    proceed();
  }

  function handleReply(messageId: string) {
    if (isProduction) {
      void handleProductionComposeSeed(messageId, "reply");
      return;
    }
    maybeGuardReply(messageId, "reply", () => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return;
      openCompose(buildReplyDraft(msg));
    });
  }

  function handleReplyAll(messageId: string) {
    if (isProduction) {
      void handleProductionComposeSeed(messageId, "reply_all");
      return;
    }
    maybeGuardReply(messageId, "reply_all", () => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return;
      openCompose(buildReplyAllDraft(msg));
    });
  }

  function handleForward(messageId: string) {
    if (isProduction) {
      void handleProductionComposeSeed(messageId, "forward");
      return;
    }
    maybeGuardReply(messageId, "forward", () => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return;
      openCompose(buildForwardDraft(msg));
    });
  }

  function handleAdminEdit(messageId: string) {
    const draft = openAdminEditApproval(messageId);
    openCompose(draft);
  }

  function selectApprovalItem() {
    if (isMobileViewport) {
      setMobileView("detail");
    }
  }

  function selectMessage(id: string) {
    if (isProduction && workspace) {
      if (workspace.selectedFolder === "drafts") {
        openCompose({ draftId: id });
        return;
      }
      void workspace.selectMessage(id);
      void workspace.markMessageRead({ messageId: id, isRead: true });
      if (isMobileViewport) {
        setMobileView("detail");
      }
      return;
    }

    const msg = messages.find((m) => m.id === id);
    if (activeFolder === "drafts" && msg?.folder === "draft") {
      setSelectedId(id);
      const draft = openDraftMessage(id);
      openCompose(draft);
      return;
    }
    setSelectedId(id);
    if (isMobileViewport) {
      setMobileView("detail");
    }
  }

  function openAdminCenter() {
    setAdminCenterOpen(true);
  }

  function openNotificationMailbox() {
    setNotificationMailboxOpen(true);
  }

  const showNotificationMailboxEntry = effectiveMailAccessEnabled;

  useEffect(() => {
    if (!effectiveMailAccessEnabled || !session?.user.id) return;
    void prefetchComposeContext(session.user.id);
  }, [effectiveMailAccessEnabled, session?.user.id]);

  useEffect(() => {
    if (customerHandledRef.current || !effectiveMailAccessEnabled) return;
    const customerId = searchParams.get("customerId");
    const customerName = searchParams.get("customerName");
    const email = searchParams.get("email");
    if (!customerId || !customerName) return;
    customerHandledRef.current = true;
    openCompose({
      to: email ? [email] : [],
      subject: "",
      body: "",
    });
  }, [effectiveMailAccessEnabled, searchParams]);

  useEffect(() => {
    if (!workspace) return;
    setMobileView((current) => (current === "compose" ? current : "list"));
  }, [workspace?.selectedFolder]);

  useEffect(() => {
    const messageId = searchParams.get("messageId");
    if (!messageId || !effectiveMailAccessEnabled) return;
    if (isProduction && workspace) {
      void workspace.selectMessage(messageId);
      if (isMobileViewport) {
        setMobileView("detail");
      }
      return;
    }
    openMessageFromNotification(messageId);
    if (isMobileViewport) {
      setMobileView("detail");
    }
  }, [
    isProduction,
    effectiveMailAccessEnabled,
    isMobileViewport,
    openMessageFromNotification,
    searchParams,
    workspace,
  ]);

  if (sessionLoading) {
    return (
      <div className="flex min-h-[calc(100dvh-4.5rem)] items-center justify-center px-6 py-16">
        <p className="text-sm crm-text-secondary">{t("common.loading")}</p>
      </div>
    );
  }

  if (sessionError && !session) {
    return (
      <div className="flex min-h-[calc(100dvh-4.5rem)] flex-col items-center justify-center px-6 py-16 text-center">
        <p className="max-w-sm text-sm crm-text-secondary">{sessionError}</p>
        <Button
          type="button"
          variant="secondary"
          className="mt-4"
          onClick={() => void refreshMailSession()}
        >
          {t("mail.adminCenter.retry")}
        </Button>
      </div>
    );
  }

  if (
    session &&
    !session.isCrmRootAdmin &&
    session.effectiveState !== "READY"
  ) {
    if (session.effectiveState === "NO_MAILBOX") {
      return (
        <div className="min-w-0 px-4 py-3 sm:px-6">
          <MailProductionNoMailboxesState />
          <MailDebugControls />
        </div>
      );
    }
    return (
      <div className="min-w-0 px-4 py-3 sm:px-6">
        <MailStaffAccessState
          state={session.effectiveState}
          dashboardHref={dashboardHref}
          onConfigureNotification={() => setNotificationMailboxOpen(true)}
        />
        <MailDebugControls />
      </div>
    );
  }

  if (workspaceShellMode === "no_access") {
    return (
      <div className="min-w-0 px-4 py-3 sm:px-6">
        <MailNoAccessState dashboardHref={dashboardHref} />
        <MailDebugControls />
      </div>
    );
  }

  if (workspaceShellMode === "admin_only") {
    return (
      <div className="min-w-0 px-4 py-3 sm:px-6">
        <MailAdminOnlyShell
          adminCenterOpen={adminCenterOpen}
          onAdminCenterOpenChange={setAdminCenterOpen}
          onOpenAdminCenter={() => setAdminCenterOpen(true)}
        />
      </div>
    );
  }

  const showProductionNoMailboxes =
    isProduction &&
    workspace &&
    !workspace.isLoadingMailboxes &&
    workspace.mailboxes.length === 0;

  if (showProductionNoMailboxes) {
    return (
      <div className="min-w-0 px-4 py-3 sm:px-6">
        <MailProductionNoMailboxesState />
        <MailDebugControls />
      </div>
    );
  }

  return (
    <div
      ref={workspaceRef}
      className="mail-prototype-root flex h-[calc(100dvh-var(--dashboard-header-offset,3.5rem))] max-h-[calc(100dvh-var(--dashboard-header-offset,3.5rem))] min-h-0 min-w-0 flex-col overflow-hidden"
    >
      <MailDesktopWorkspace
        workspaceRef={workspaceRef}
        composeOpen={composeOpen}
        composeExpanded={composeExpanded}
        composeKey={composeKey}
        composeSeed={composeSeed}
        mailFolder={mailFolder}
        onOpenCompose={openCompose}
        onCloseCompose={closeCompose}
        onToggleComposeExpand={() => setComposeExpanded((v) => !v)}
        onComposeDraftPersisted={handleComposeDraftPersisted}
        onReply={handleReply}
        onReplyAll={handleReplyAll}
        onForward={handleForward}
        onAdminEdit={handleAdminEdit}
        onSelectMessage={selectMessage}
        replyGuard={replyGuard}
        onDismissReplyGuard={() => setReplyGuard(null)}
        onProceedReplyGuard={() => proceedReplyAction(replyGuard)}
        onProductionSeedAction={handleProductionSeedAction}
        composeSeedPending={composeSeedPending}
        showAdminEntry={canOpenAdminCenter}
        onOpenAdminCenter={openAdminCenter}
        showNotificationMailboxEntry={showNotificationMailboxEntry}
        onOpenNotificationMailbox={openNotificationMailbox}
        adminCenterReturnFocusRef={desktopSettingsRef}
      />

      <div className="mail-mobile-workspace flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:hidden">
        {mobileView === "list" && (
          <>
            <MailFolderActionRow
              ref={folderTriggerRef}
              folderPopoverOpen={folderPopoverOpen}
              onOpenFolders={() => setFolderPopoverOpen((v) => !v)}
              onCompose={() => openCompose()}
              settingsOpen={mobileSettingsOpen}
              onToggleSettings={() => setMobileSettingsOpen((v) => !v)}
              onCloseSettings={() => setMobileSettingsOpen(false)}
              showAdminEntry={canOpenAdminCenter}
              onOpenAdminCenter={openAdminCenter}
              showNotificationMailboxEntry={showNotificationMailboxEntry}
              onOpenNotificationMailbox={openNotificationMailbox}
              settingsButtonRef={mobileSettingsRef}
            />
            <MailMessageList
              className="flex min-h-0 min-w-0 flex-1 flex-col"
              onMessageSelect={selectMessage}
              onApprovalItemSelect={selectApprovalItem}
            />
          </>
        )}

        {mobileView === "detail" && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-2 border-b crm-border px-3 py-1.5">
              <button
                type="button"
                onClick={() => setMobileView("list")}
                className="flex min-h-9 items-center gap-1 text-sm crm-text"
              >
                <ArrowLeft className="h-4 w-4 shrink-0" />
                {t("mail.compose.backToMail")}
              </button>
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <MailReadingPane
                onReply={handleReply}
                onReplyAll={handleReplyAll}
                onForward={handleForward}
                onAdminEdit={handleAdminEdit}
                replyGuard={replyGuard}
                onDismissReplyGuard={() => setReplyGuard(null)}
                onProceedReplyGuard={() => proceedReplyAction(replyGuard)}
                onProductionSeedAction={handleProductionSeedAction}
                composeSeedPending={composeSeedPending}
              />
            </div>
          </div>
        )}

        {mobileView === "compose" && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <MailComposeEditor
              key={composeSeed?.draftId ?? `new-${composeKey}`}
              seed={composeSeed}
              variant="embedded-mobile"
              onBack={closeCompose}
              onSubmitted={closeCompose}
            />
          </div>
        )}
      </div>

      <MailFolderPopover
        open={folderPopoverOpen && isMobileViewport}
        onClose={() => setFolderPopoverOpen(false)}
        anchorRef={folderTriggerRef}
      />

      <MailDebugControls />

      {toast && (
        <div
          className="fixed bottom-24 left-1/2 z-[60] max-w-[min(90vw,24rem)] -translate-x-1/2 rounded-lg bg-neutral-900 px-4 py-2.5 text-center text-sm text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900 md:bottom-8"
          role="status"
          onClick={clearToast}
        >
          {toast}
        </div>
      )}

      <MailAdminCenterDrawer
        open={adminCenterOpen}
        onRequestClose={() => setAdminCenterOpen(false)}
        returnFocusRef={isMobileViewport ? mobileSettingsRef : desktopSettingsRef}
      />
      <NotificationMailboxSelfServiceModal
        open={notificationMailboxOpen}
        onClose={() => setNotificationMailboxOpen(false)}
        onUpdated={() => void refreshMailSession({ background: true })}
      />
    </div>
  );
}
