"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import {
  getTeamMemberName,
  isSharedMailboxMessage,
} from "@/lib/mail/prototype/shared-mailbox";
import type { MailMessage } from "@/lib/mail/prototype/types";
import type { MockTeamMemberId } from "@/lib/mail/prototype/shared-mailbox-types";
import { formatHongKongDateTime } from "@/lib/timezone";

function renderNoteContent(content: string) {
  const parts = content.split(/(@Employee [AB]|@Daniel)/g);
  return parts.map((part, i) => {
    if (part.startsWith("@")) {
      return (
        <span
          key={i}
          className="rounded bg-blue-500/10 px-0.5 text-blue-700 dark:text-blue-300"
        >
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export function MailInternalNotes({
  message,
  compact,
}: {
  message: MailMessage;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const {
    sharedPermission,
    getNotesForMessage,
    addInternalNote,
    getMentionCandidates,
    currentTeamMemberId,
  } = useMailPrototype();
  const [expanded, setExpanded] = useState(!compact);
  const [draft, setDraft] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");

  const notes = getNotesForMessage(message.id);
  const canWrite = sharedPermission.canReply;

  const mentionCandidates = useMemo(() => {
    const q = mentionQuery.toLowerCase();
    return getMentionCandidates().filter((id) => {
      const name = getTeamMemberName(id).toLowerCase();
      return !q || name.includes(q) || id.includes(q);
    });
  }, [getMentionCandidates, mentionQuery]);

  if (!isSharedMailboxMessage(message)) return null;
  if (!sharedPermission.canRead) return null;

  function insertMention(id: MockTeamMemberId) {
    const token = `@${getTeamMemberName(id)}`;
    setDraft((d) => (d.endsWith("@") ? d.slice(0, -1) + token + " " : d + token + " "));
    setMentionOpen(false);
    setMentionQuery("");
  }

  function handleSubmit() {
    const text = draft.trim();
    if (!text || !canWrite) return;
    const mentions = getMentionCandidates().filter((id) =>
      text.includes(`@${getTeamMemberName(id)}`),
    );
    addInternalNote(message.id, text, mentions);
    setDraft("");
  }

  return (
    <section
      className={cn(
        "border-t crm-border",
        compact ? "px-3 py-3" : "px-4 py-4 sm:px-6",
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between text-left text-xs font-medium uppercase tracking-wide crm-text-secondary"
      >
        <span>
          {t("mail.shared.internalNotes")}{" "}
          {notes.length > 0 && `(${notes.length})`}
        </span>
        {compact && (
          <span className="text-[10px] normal-case">{expanded ? "−" : "+"}</span>
        )}
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] crm-text-secondary">
            {t("mail.shared.internalNotesHint")}
          </p>
          {notes.map((note) => (
            <div
              key={note.id}
              className="rounded-md border border-blue-500/15 bg-blue-500/[0.04] px-3 py-2 text-sm"
            >
              <p className="text-xs crm-text-secondary">
                {getTeamMemberName(note.authorId)} ·{" "}
                {formatHongKongDateTime(note.createdAt).split(" ")[1] ?? ""}
              </p>
              <p className="mt-1 whitespace-pre-wrap crm-text">
                {renderNoteContent(note.content)}
              </p>
            </div>
          ))}
          {canWrite ? (
            <div className="relative">
              <textarea
                value={draft}
                onChange={(e) => {
                  const v = e.target.value;
                  setDraft(v);
                  if (v.endsWith("@")) {
                    setMentionOpen(true);
                    setMentionQuery("");
                  }
                }}
                placeholder={t("mail.shared.notePlaceholder")}
                rows={2}
                className="w-full rounded-md border crm-border bg-transparent px-3 py-2 text-sm crm-text"
              />
              {mentionOpen && (
                <div className="absolute bottom-full left-0 z-40 mb-1 w-44 rounded-md border crm-border bg-[var(--color-crm-bg)] py-1 shadow-sm">
                  {mentionCandidates.map((id) => (
                    <button
                      key={id}
                      type="button"
                      disabled={id === currentTeamMemberId}
                      className="block w-full px-3 py-1.5 text-left text-sm hover:bg-black/[0.03] disabled:opacity-40 dark:hover:bg-white/[0.04]"
                      onClick={() => insertMention(id)}
                    >
                      {getTeamMemberName(id)}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!draft.trim()}
                className="mt-1 text-sm link-primary disabled:opacity-40"
              >
                {t("mail.shared.addNote")}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
