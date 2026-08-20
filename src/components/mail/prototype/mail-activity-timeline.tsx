"use client";

import { useTranslation } from "@/i18n/provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import { getTeamMemberName, isSharedMailboxMessage } from "@/lib/mail/prototype/shared-mailbox";
import type { MailMessage } from "@/lib/mail/prototype/types";
import { formatHongKongDateTime } from "@/lib/timezone";
import { cn } from "@/lib/cn";

export function MailActivityTimeline({
  message,
  compact,
}: {
  message: MailMessage;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { getActivityForMessage } = useMailPrototype();
  const events = getActivityForMessage(message.id);

  if (!isSharedMailboxMessage(message) || events.length === 0) return null;

  return (
    <section
      className={cn(
        "border-t crm-border",
        compact ? "px-3 py-3" : "px-4 py-4 sm:px-6",
      )}
    >
      <h3 className="text-xs font-medium uppercase tracking-wide crm-text-secondary">
        {t("mail.shared.activity")}
      </h3>
      <ul className="mt-2 space-y-2">
        {[...events].reverse().map((ev) => (
          <li key={ev.id} className="text-xs crm-text-secondary">
            <span className="crm-text">{getTeamMemberName(ev.actorId)}</span>
            {" · "}
            {t(`mail.shared.activityType.${ev.type}`, {
              name: ev.metadata?.toAssigneeId
                ? getTeamMemberName(ev.metadata.toAssigneeId)
                : "",
              status: ev.metadata?.status
                ? t(`mail.shared.status.${ev.metadata.status}`)
                : "",
            })}
            {" · "}
            {formatHongKongDateTime(ev.timestamp)}
          </li>
        ))}
      </ul>
    </section>
  );
}
