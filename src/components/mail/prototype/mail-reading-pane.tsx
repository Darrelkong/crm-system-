"use client";

import { useIsProductionMailReadSource } from "@/lib/mail/client/mail-read-source-context";
import { MailMessageDetail } from "./mail-message-detail";
import { MailProductionReadingPane } from "./mail-production-reading-pane";

import type { ProductionComposeSeedAction } from "@/components/mail/prototype/mail-production-message-actions";

export function MailReadingPane({
  onReply,
  onReplyAll,
  onForward,
  onAdminEdit,
  variant = "default",
  messageListCollapsed = false,
  onShowMessageList,
  replyGuard,
  onDismissReplyGuard,
  onProceedReplyGuard,
  onProductionSeedAction,
  composeSeedPending = false,
}: {
  onReply: (messageId: string) => void;
  onReplyAll?: (messageId: string) => void;
  onForward?: (messageId: string) => void;
  onAdminEdit?: (messageId: string) => void;
  variant?: "default" | "desktop";
  messageListCollapsed?: boolean;
  onShowMessageList?: () => void;
  replyGuard?: { messageId: string; action: "reply" | "reply_all" | "forward" } | null;
  onDismissReplyGuard?: () => void;
  onProceedReplyGuard?: () => void;
  onProductionSeedAction?: (
    messageId: string,
    mode: ProductionComposeSeedAction,
  ) => void;
  composeSeedPending?: boolean;
}) {
  const isProduction = useIsProductionMailReadSource();

  if (isProduction) {
    return (
      <MailProductionReadingPane
        variant={variant}
        messageListCollapsed={messageListCollapsed}
        onShowMessageList={onShowMessageList}
        onSeedAction={onProductionSeedAction}
        composeSeedPending={composeSeedPending}
      />
    );
  }

  return (
    <MailMessageDetail
      onReply={onReply}
      onReplyAll={onReplyAll}
      onForward={onForward}
      onAdminEdit={onAdminEdit}
      variant={variant}
      messageListCollapsed={messageListCollapsed}
      onShowMessageList={onShowMessageList}
      replyGuard={replyGuard}
      onDismissReplyGuard={onDismissReplyGuard}
      onProceedReplyGuard={onProceedReplyGuard}
    />
  );
}
