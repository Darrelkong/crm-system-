"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import { MailFolderActionRow } from "./mail-folder-action-row";
import { MailFolderPopover } from "./mail-folder-popover";
import { MailMessageList } from "./mail-message-list";
import { MailMessageDetail } from "./mail-message-detail";
import { MailCompose, type ComposeDraft } from "./mail-compose";
import { MailNoAccessState } from "./mail-no-access-state";
import { MailDebugControls } from "./mail-debug-controls";
import { MailDesktopWorkspace } from "./mail-desktop-workspace";
import {
  buildForwardDraft,
  buildReplyAllDraft,
  buildReplyDraft,
} from "@/lib/mail/prototype/message-actions";
import {
  shouldWarnSharedReply,
} from "@/lib/mail/prototype/shared-mailbox";

type MobileView = "list" | "detail" | "compose";
type ReplyGuardAction = "reply" | "reply_all" | "forward";
type ReplyGuardState = { messageId: string; action: ReplyGuardAction } | null;

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

export function MailPrototypeShell({ role: _role }: { role: "admin" }) {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const isMobileViewport = useMobileViewport();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const folderTriggerRef = useRef<HTMLButtonElement>(null);
  const customerHandledRef = useRef(false);

  const {
    hasMailAccess,
    messages,
    selectedId,
    setSelectedId,
    activeFolder,
    toast,
    clearToast,
    initComposeDraft,
    composeDraft,
    openDraftMessage,
    senderIdentities,
    openAdminEditApproval,
    currentTeamMemberId,
    openMessageFromNotification,
  } = useMailPrototype();

  const [mobileView, setMobileView] = useState<MobileView>("list");
  const [folderPopoverOpen, setFolderPopoverOpen] = useState(false);
  const [composeKey, setComposeKey] = useState(0);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeExpanded, setComposeExpanded] = useState(false);
  const [replyGuard, setReplyGuard] = useState<ReplyGuardState>(null);

  function openCompose(initial?: Partial<ComposeDraft>) {
    if (initial) {
      initComposeDraft({
        from: initial.from,
        to: normalizeRecipients(initial.to),
        cc: normalizeRecipients(initial.cc),
        bcc: normalizeRecipients(initial.bcc),
        subject: initial.subject ?? "",
        body: initial.body ?? "",
        replyToId: initial.replyToId,
        mode: initial.mode,
        draftMessageId: initial.draftMessageId,
        quotedOriginal: initial.quotedOriginal,
        forwardAttachments: initial.forwardAttachments,
        selectedForwardAttachmentIds: initial.selectedForwardAttachmentIds,
        customerAssociation: initial.customerAssociation,
        sensitivity: initial.sensitivity,
        submittedByName: initial.submittedByName,
        approvalMessageId: initial.approvalMessageId,
        adminEdited: initial.adminEdited,
        approvalOriginal: initial.approvalOriginal,
        mockAttachmentCount: initial.mockAttachmentCount,
      });
      setComposeKey((k) => k + 1);
    } else if (!composeDraft) {
      initComposeDraft();
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
    maybeGuardReply(messageId, "reply", () => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return;
      openCompose(buildReplyDraft(msg));
    });
  }

  function handleReplyAll(messageId: string) {
    maybeGuardReply(messageId, "reply_all", () => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return;
      openCompose(buildReplyAllDraft(msg));
    });
  }

  function handleForward(messageId: string) {
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

  function selectMessage(id: string) {
    const msg = messages.find((m) => m.id === id);
    if (activeFolder === "drafts" && msg?.folder === "draft") {
      const draft = openDraftMessage(id);
      openCompose(draft);
      return;
    }
    setSelectedId(id);
    if (isMobileViewport) {
      setMobileView("detail");
    }
  }

  useEffect(() => {
    if (customerHandledRef.current || !hasMailAccess) return;
    const customerId = searchParams.get("customerId");
    const customerName = searchParams.get("customerName");
    const email = searchParams.get("email");
    if (!customerId || !customerName) return;
    customerHandledRef.current = true;
    const defaultFrom = senderIdentities[0]?.address ?? "";
    openCompose({
      from: defaultFrom,
      to: email ? [email] : [],
      customerAssociation: { id: customerId, name: customerName },
      mode: "new",
    });
  }, [hasMailAccess, searchParams, senderIdentities]);

  useEffect(() => {
    const messageId = searchParams.get("messageId");
    if (!messageId || !hasMailAccess) return;
    openMessageFromNotification(messageId);
    if (isMobileViewport) {
      setMobileView("detail");
    }
  }, [hasMailAccess, isMobileViewport, openMessageFromNotification, searchParams]);

  if (!hasMailAccess) {
    return (
      <div className="min-w-0 px-4 py-3 sm:px-6">
        <MailNoAccessState />
        <MailDebugControls />
      </div>
    );
  }

  return (
    <div
      ref={workspaceRef}
      className="mail-prototype-root flex min-h-[calc(100dvh-4.5rem)] min-w-0 flex-col"
    >
      <MailDesktopWorkspace
        workspaceRef={workspaceRef}
        composeOpen={composeOpen}
        composeExpanded={composeExpanded}
        composeKey={composeKey}
        onOpenCompose={openCompose}
        onCloseCompose={closeCompose}
        onToggleComposeExpand={() => setComposeExpanded((v) => !v)}
        onReply={handleReply}
        onReplyAll={handleReplyAll}
        onForward={handleForward}
        onAdminEdit={handleAdminEdit}
        onSelectMessage={selectMessage}
        replyGuard={replyGuard}
        onDismissReplyGuard={() => setReplyGuard(null)}
        onProceedReplyGuard={() => proceedReplyAction(replyGuard)}
      />

      <div className="mail-mobile-workspace flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:hidden">
        {mobileView === "list" && (
          <>
            <MailFolderActionRow
              ref={folderTriggerRef}
              folderPopoverOpen={folderPopoverOpen}
              onOpenFolders={() => setFolderPopoverOpen((v) => !v)}
              onCompose={() => openCompose()}
            />
            <MailMessageList
              className="flex min-h-0 min-w-0 flex-1 flex-col"
              onMessageSelect={selectMessage}
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
              <MailMessageDetail
                onReply={handleReply}
                onReplyAll={handleReplyAll}
                onForward={handleForward}
                onAdminEdit={handleAdminEdit}
                replyGuard={replyGuard}
                onDismissReplyGuard={() => setReplyGuard(null)}
                onProceedReplyGuard={() => proceedReplyAction(replyGuard)}
              />
            </div>
          </div>
        )}

        {mobileView === "compose" && composeDraft && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <MailCompose
              key={composeKey}
              variant="embedded-mobile"
              onBack={closeCompose}
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
    </div>
  );
}
