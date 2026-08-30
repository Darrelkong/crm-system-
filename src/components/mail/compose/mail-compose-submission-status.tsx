"use client";

import { useTranslation } from "@/i18n/provider";
import { MailApprovalStatusBadge } from "@/components/mail/shared/mail-approval-status-badge";
import { resolveLatestReturnReason } from "@/lib/mail/client/approval-workflow-management";
import type { ApprovalApiItem } from "@/lib/mail/client/approval-workflow-management";
import type { SendDeliveryDisplayPhase } from "@/lib/mail/client/approved-outbound-queue";
import { resolveSendDeliveryLifecycleLabelKey } from "@/lib/mail/client/approved-outbound-queue";
import type { ComposeSubmissionPhase } from "@/lib/mail/client/compose-submission";

export function MailComposeSubmissionStatus({
  phase,
  approval,
  submissionError,
  outboundDisplayPhase,
  composeOutboundWorkflow,
}: {
  phase: ComposeSubmissionPhase;
  approval: ApprovalApiItem | null;
  submissionError: string | null;
  outboundDisplayPhase?: SendDeliveryDisplayPhase;
  composeOutboundWorkflow?: "admin_direct" | "staff_approved";
}) {
  const { t } = useTranslation();

  if (submissionError) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400" role="alert">
        {submissionError}
      </p>
    );
  }

  if (phase === "submitting") {
    return (
      <p className="text-sm crm-text-secondary" aria-live="polite">
        {t("mail.compose.submitting")}
      </p>
    );
  }

  if (!approval) {
    if (
      composeOutboundWorkflow === "admin_direct" &&
      phase === "approved" &&
      outboundDisplayPhase
    ) {
      return (
        <p className="text-sm crm-text-secondary" aria-live="polite">
          {t(resolveSendDeliveryLifecycleLabelKey(outboundDisplayPhase))}
        </p>
      );
    }
    return null;
  }

  const returnReason = resolveLatestReturnReason(approval.events ?? []);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <MailApprovalStatusBadge status={approval.status} />
        {phase === "pending_approval" ? (
          <span className="text-sm crm-text-secondary">
            {t("mail.compose.pendingApprovalHint")}
          </span>
        ) : null}
        {phase === "approved" ? (
          <span className="text-sm crm-text-secondary">
            {t(resolveSendDeliveryLifecycleLabelKey(outboundDisplayPhase ?? "approved_only"))}
          </span>
        ) : null}
      </div>
      {phase === "returned" && returnReason ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          {t("mail.message.returnReason")}: {returnReason}
        </p>
      ) : null}
    </div>
  );
}
