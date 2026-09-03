"use client";

import { Badge } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";
import {
  resolveApprovalHistoryResult,
  type ApprovalStatus,
} from "@/lib/mail/client/approval-workflow-management";

export function MailApprovalResultBadge({
  status,
}: {
  status: ApprovalStatus;
}) {
  const { t } = useTranslation();
  const result = resolveApprovalHistoryResult(status);
  const variant =
    result === "approved"
      ? "success"
      : result === "rejected"
        ? "danger"
        : "default";

  return (
    <Badge variant={variant}>
      {t(
        result
          ? `mail.approvalCenter.result.${result}`
          : "mail.approvalCenter.result.pending",
      )}
    </Badge>
  );
}
