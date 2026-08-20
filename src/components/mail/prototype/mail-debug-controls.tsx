"use client";

import { useState } from "react";
import { useTranslation } from "@/i18n/provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import { getTeamMemberName } from "@/lib/mail/prototype/shared-mailbox";
import type { SharedPermissionLevel } from "@/lib/mail/prototype/shared-mailbox-types";
import { MailScenarioSwitcher } from "./mail-scenario-switcher";

const PERMISSION_LEVELS: SharedPermissionLevel[] = [
  "full",
  "reply",
  "read_only",
];

export function MailDebugControls() {
  const { t } = useTranslation();
  const {
    sharedPermissionLevel,
    setSharedPermissionLevel,
    mentionNotifications,
    currentTeamMemberId,
    openMessageFromNotification,
  } = useMailPrototype();
  const [open, setOpen] = useState(false);

  const myMentions = mentionNotifications.filter(
    (n) => n.targetUserId === currentTeamMemberId,
  );

  return (
    <div
      className="pointer-events-none fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-2 z-[70] md:bottom-3 md:right-3"
      aria-hidden={!open}
    >
      <div className="pointer-events-auto flex flex-col items-end gap-1">
        {open && (
          <div className="max-w-[min(90vw,18rem)] space-y-2 rounded-md border crm-border bg-[var(--color-crm-bg)] p-2 shadow-sm">
            <MailScenarioSwitcher className="w-full" />
            <label className="block text-[10px] crm-text-secondary">
              {t("mail.shared.debugPermission")}
              <select
                value={sharedPermissionLevel}
                onChange={(e) =>
                  setSharedPermissionLevel(
                    e.target.value as SharedPermissionLevel,
                  )
                }
                className="mt-0.5 w-full rounded-md border crm-border bg-transparent px-2 py-1 text-xs crm-text"
              >
                {PERMISSION_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {t(`mail.shared.permissionLevel.${level}`)}
                  </option>
                ))}
              </select>
            </label>
            {myMentions.length > 0 && (
              <div className="border-t crm-border pt-2">
                <p className="text-[10px] font-medium crm-text-secondary">
                  {t("mail.shared.mentionNotifications")}
                </p>
                <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                  {myMentions.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        className="w-full rounded px-1 py-1 text-left text-[10px] hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                        onClick={() => openMessageFromNotification(n.messageId)}
                      >
                        {t("mail.shared.mentionNotification", {
                          author: getTeamMemberName(n.authorId),
                          mailbox: n.mailboxDisplayName,
                          subject: n.subjectPreview,
                        })}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-dashed border-amber-500/35 bg-[var(--color-crm-bg)]/90 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 shadow-sm backdrop-blur-sm dark:text-amber-300"
          aria-expanded={open}
          aria-label="Toggle prototype debug controls"
        >
          DBG
        </button>
      </div>
    </div>
  );
}
