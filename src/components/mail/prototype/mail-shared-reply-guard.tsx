"use client";

import { useTranslation } from "@/i18n/provider";
import { getTeamMemberName } from "@/lib/mail/prototype/shared-mailbox";
import type { MailMessage } from "@/lib/mail/prototype/types";
import { Button } from "@/components/ui/button";

export function MailSharedReplyGuard({
  message,
  onCancel,
  onProceed,
}: {
  message: MailMessage;
  onCancel: () => void;
  onProceed: () => void;
}) {
  const { t } = useTranslation();
  const assignee = message.assigneeId;

  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-sm">
      <p className="crm-text">
        {t("mail.shared.replyGuard", {
          name: assignee ? getTeamMemberName(assignee) : "",
        })}
      </p>
      <div className="mt-2 flex gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          {t("common.back")}
        </Button>
        <Button type="button" size="sm" onClick={onProceed}>
          {t("mail.shared.replyAnyway")}
        </Button>
      </div>
    </div>
  );
}
