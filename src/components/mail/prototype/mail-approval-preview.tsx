"use client";

import { useState } from "react";
import { useTranslation } from "@/i18n/provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import type { MailMessage } from "@/lib/mail/prototype/types";
import { Button } from "@/components/ui/button";
import { formatHongKongDateTime } from "@/lib/timezone";
import { getAdminGlobalCustomerMatches } from "@/lib/mail/prototype/recipient-permissions";
import { MailSignaturePreview } from "./mail-signature-preview";

export function MailApprovalPreview({
  message,
  onClose,
  onEdit,
}: {
  message: MailMessage;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const { t } = useTranslation();
  const { approveMessage, returnMessage } = useMailPrototype();
  const [returnReason, setReturnReason] = useState("");
  const [showReturn, setShowReturn] = useState(false);

  const recipientWarnings = [...message.to, ...(message.cc ?? [])].flatMap(
    (email) => {
      const matches = getAdminGlobalCustomerMatches(email);
      if (matches.length === 0) return [];
      return [{ email, matches }];
    },
  );

  return (
    <div className="surface-card flex max-h-[min(90vh,720px)] flex-col overflow-hidden">
      <div className="border-b crm-border px-4 py-3 sm:px-5">
        <h3 className="text-base font-semibold crm-text">
          {t("mail.approval.title")}
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="crm-text-secondary">{t("mail.detail.from")}</dt>
            <dd className="crm-text">
              {message.fromName} &lt;{message.fromEmail}&gt;
            </dd>
          </div>
          <div>
            <dt className="crm-text-secondary">{t("mail.detail.to")}</dt>
            <dd className="crm-text">{message.to.join(", ")}</dd>
          </div>
          {message.cc && message.cc.length > 0 && (
            <div>
              <dt className="crm-text-secondary">CC</dt>
              <dd className="crm-text">{message.cc.join(", ")}</dd>
            </div>
          )}
          <div>
            <dt className="crm-text-secondary">{t("mail.detail.subject")}</dt>
            <dd className="font-medium crm-text">{message.subject}</dd>
          </div>
          <div>
            <dt className="crm-text-secondary">{t("mail.detail.body")}</dt>
            <dd className="whitespace-pre-wrap crm-text">{message.body}</dd>
          </div>
          {message.attachments.length > 0 && (
            <div>
              <dt className="crm-text-secondary">{t("mail.detail.attachments")}</dt>
              <dd className="space-y-1">
                {message.attachments.map((a) => (
                  <p key={a.id} className="crm-text">
                    {a.name} ({a.sizeLabel})
                    {a.kind === "secure_file" && (
                      <span className="ml-1 text-xs crm-text-secondary">
                        — {t("mail.attachment.secureFile")}
                      </span>
                    )}
                  </p>
                ))}
              </dd>
            </div>
          )}
          {recipientWarnings.length > 0 && (
            <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2">
              {recipientWarnings.map(({ email, matches }) => (
                <div key={email}>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    {t("mail.approval.recipientCrmWarning")}
                  </p>
                  {matches.map((m) => (
                    <p key={m.id} className="text-sm crm-text">
                      {t("mail.approval.matchedCrmCustomer")}: {m.name} (
                      {m.customerCode})
                      <span className="block text-xs crm-text-secondary">
                        {t("mail.approval.currentOwner", { name: m.ownerName })}
                      </span>
                    </p>
                  ))}
                </div>
              ))}
            </div>
          )}
          {message.submittedByName && (
            <div>
              <dt className="crm-text-secondary">
                {t("mail.approval.submittedBy")}
              </dt>
              <dd className="crm-text">{message.submittedByName}</dd>
            </div>
          )}
          {message.submittedAt && (
            <div>
              <dt className="crm-text-secondary">
                {t("mail.approval.submittedAt")}
              </dt>
              <dd className="crm-text">
                {formatHongKongDateTime(message.submittedAt)}
              </dd>
            </div>
          )}
          {message.adminEdited && (
            <p className="text-xs crm-text-secondary">
              {t("mail.approval.adminEdited")}
            </p>
          )}
          {message.approvalOriginal && (
            <details className="text-xs crm-text-secondary">
              <summary>{t("mail.approval.viewOriginal")}</summary>
              <p className="mt-1 whitespace-pre-wrap">{message.approvalOriginal.body}</p>
            </details>
          )}
        </dl>
        <MailSignaturePreview isStaff />
      </div>
      {showReturn ? (
        <div className="border-t crm-border px-4 py-3 sm:px-5">
          <textarea
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
            placeholder={t("mail.approval.returnReasonPlaceholder")}
            className="mb-3 min-h-20 w-full rounded-xl border crm-border bg-transparent px-3 py-2 text-sm crm-text"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowReturn(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={!returnReason.trim()}
              onClick={() => {
                returnMessage(message.id, returnReason.trim());
                onClose();
              }}
            >
              {t("mail.approval.return")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 border-t crm-border px-4 py-3 sm:px-5">
          <Button
            type="button"
            onClick={() => {
              approveMessage(message.id);
              onClose();
            }}
          >
            {t("mail.approval.approveAndSend")}
          </Button>
          {onEdit && (
            <Button type="button" variant="secondary" onClick={onEdit}>
              {t("mail.approval.editAndSend")}
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            onClick={() => setShowReturn(true)}
          >
            {t("mail.approval.return")}
          </Button>
        </div>
      )}
    </div>
  );
}
