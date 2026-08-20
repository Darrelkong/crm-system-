export type DraftLike = {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  mockAttachmentCount?: number;
};

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

export function hasMeaningfulDraftContent(draft: DraftLike): boolean {
  const hasRecipients =
    (draft.to?.length ?? 0) > 0 ||
    (draft.cc?.length ?? 0) > 0 ||
    (draft.bcc?.length ?? 0) > 0;
  const hasSubject = Boolean(draft.subject?.trim());
  const hasBody = Boolean(stripHtml(draft.body ?? ""));
  const hasAttachments = (draft.mockAttachmentCount ?? 0) > 0;
  return hasRecipients || hasSubject || hasBody || hasAttachments;
}

export function isBlankDraft(draft: DraftLike | null): boolean {
  if (!draft) return true;
  return !hasMeaningfulDraftContent(draft);
}

export function draftPreviewLabel(draft: {
  to?: string[];
  subject?: string;
}): { recipient: string; subject: string } {
  const recipient =
    draft.to && draft.to.length > 0
      ? draft.to.join(", ")
      : "noRecipient";
  const subject = draft.subject?.trim() ? draft.subject : "noSubject";
  return { recipient, subject };
}
