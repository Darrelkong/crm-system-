"use client";

import { Badge } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";
import type { ApprovalStatus } from "@/lib/mail/client/approval-workflow-management";

export function MailApprovalStatusBadge({
  status,
}: {
  status: ApprovalStatus;
}) {
  const { t } = useTranslation();
  const variant =
    status === "approved"
      ? "success"
      : status === "pending"
        ? "warning"
        : status === "returned"
          ? "danger"
          : "default";
  return (
    <Badge variant={variant}>
      {t(`mail.adminCenter.approval.status.${status}`)}
    </Badge>
  );
}
