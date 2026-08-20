"use client";

import { useTranslation } from "@/i18n/provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import { Button } from "@/components/ui/button";

export function MailAssignmentControl({
  messageId,
  onReply,
}: {
  messageId: string;
  onReply: () => void;
}) {
  const { t } = useTranslation();
  const { messages, claimMessage } = useMailPrototype();
  const message = messages.find((m) => m.id === messageId);
  if (!message) return null;

  if (message.assignment === "unassigned") {
    return (
      <Button type="button" onClick={() => claimMessage(messageId)}>
        {t("mail.assignment.claim")}
      </Button>
    );
  }

  if (message.assignment === "assigned_to_other") {
    return (
      <p className="text-sm crm-text-secondary">
        {t("mail.assignment.assignedToOther", {
          name: message.assignedToName ?? "",
        })}
      </p>
    );
  }

  if (
    message.assignment === "assigned_to_me" ||
    message.assignment === "none"
  ) {
    return (
      <Button type="button" variant="secondary" onClick={onReply}>
        {t("mail.compose.reply")}
      </Button>
    );
  }

  return null;
}
