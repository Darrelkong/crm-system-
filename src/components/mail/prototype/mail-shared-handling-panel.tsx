"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import type { MailMessage } from "@/lib/mail/prototype/types";
import type {
  MockTeamMemberId,
  SharedProcessingStatus,
} from "@/lib/mail/prototype/shared-mailbox-types";
import {
  getTeamMemberName,
  isSharedMailboxMessage,
} from "@/lib/mail/prototype/shared-mailbox";
import { Button } from "@/components/ui/button";

const STATUSES: SharedProcessingStatus[] = [
  "unclaimed",
  "in_progress",
  "waiting_customer",
  "completed",
];

export function MailSharedHandlingPanel({
  message,
  compact,
}: {
  message: MailMessage;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const {
    currentTeamMemberId,
    sharedPermission,
    claimSharedMessage,
    setSharedProcessingStatus,
    transferSharedMessage,
    getTransferCandidates,
  } = useMailPrototype();
  const [transferOpen, setTransferOpen] = useState(false);

  if (!isSharedMailboxMessage(message)) return null;

  const status = message.processingStatus ?? "unclaimed";
  const assignee = message.assigneeId;
  const canManage =
    sharedPermission.canReply &&
    (assignee === currentTeamMemberId ||
      currentTeamMemberId === "admin" ||
      !assignee);
  const canClaim = sharedPermission.canReply && status === "unclaimed";
  const canTransfer =
    sharedPermission.canReply &&
    assignee &&
    (assignee === currentTeamMemberId || currentTeamMemberId === "admin");

  return (
    <section
      className={cn(
        "border-t crm-border",
        compact ? "px-3 py-3" : "px-4 py-4 sm:px-6",
      )}
    >
      <h3 className="text-xs font-medium uppercase tracking-wide crm-text-secondary">
        {t("mail.shared.handling")}
      </h3>
      <div className="mt-2 space-y-2 text-sm">
        {status === "unclaimed" && !assignee ? (
          <p className="crm-text-secondary">{t("mail.shared.unclaimedHint")}</p>
        ) : assignee ? (
          <p className="crm-text">
            {t("mail.shared.handledBy", {
              name: getTeamMemberName(assignee),
              status: t(`mail.shared.status.${status}`),
            })}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {canClaim && (
            <Button type="button" size="sm" onClick={() => claimSharedMessage(message.id)}>
              {t("mail.shared.claim")}
            </Button>
          )}
          {canManage && (
            <label className="inline-flex min-h-9 items-center gap-1.5 text-sm">
              <span className="crm-text-secondary">{t("mail.shared.statusLabel")}</span>
              <select
                value={status}
                onChange={(e) =>
                  setSharedProcessingStatus(
                    message.id,
                    e.target.value as SharedProcessingStatus,
                  )
                }
                className="rounded-md border crm-border bg-transparent px-2 py-1 text-sm crm-text"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`mail.shared.status.${s}`)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {canTransfer && (
            <div className="relative">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setTransferOpen((v) => !v)}
              >
                {t("mail.shared.transfer")}
              </Button>
              {transferOpen && (
                <div className="absolute left-0 top-full z-40 mt-1 w-48 rounded-md border crm-border bg-[var(--color-crm-bg)] py-1 shadow-sm">
                  {getTransferCandidates().map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                      onClick={() => {
                        transferSharedMessage(message.id, id);
                        setTransferOpen(false);
                      }}
                    >
                      {getTeamMemberName(id)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {!sharedPermission.canReply && sharedPermission.canRead && (
          <p className="text-xs crm-text-secondary">
            {t("mail.shared.readOnlyHint")}
          </p>
        )}
      </div>
    </section>
  );
}
