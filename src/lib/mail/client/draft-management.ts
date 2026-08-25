import type { ComposeAttachmentUploadState } from "@/lib/mail/client/compose-attachment-upload";
import {
  chipsToEmails,
  countUniqueRecipients,
  type RecipientChipData,
  type RecipientLists,
  recipientListsToApiPayload,
  recipientViewsToLists,
} from "@/lib/mail/client/recipient-input";

export const COMPOSE_CONTEXT_PATH = "/api/mail/compose/context";
export const DRAFTS_PATH = "/api/mail/drafts";

export type ComposeDraftSeedMode = "reply" | "reply_all" | "forward";

export function composeDraftSeedPath(messageId: string): string {
  return `/api/mail/messages/${encodeURIComponent(messageId)}/compose-draft`;
}

export type ComposeContextOption = {
  senderIdentityId: string;
  mailboxId: string;
  address: string;
  displayName: string | null;
  mailboxAddress: string;
  mailboxDisplayName: string | null;
  mailboxType: "personal" | "shared";
};

export type DraftApiItem = {
  id: string;
  authorUserId: string;
  mailboxId: string | null;
  senderIdentityId: string | null;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  hasHtml: boolean;
  sensitivity: "normal" | "sensitive" | "restricted";
  composeMode: "new" | "reply" | "reply_all" | "forward";
  replyToMessageId: string | null;
  autosaveVersion: number;
  lastSavedAt: string;
  discardedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DraftDetailApiItem = DraftApiItem & {
  recipients: Array<{
    id: string;
    recipientType: "to" | "cc" | "bcc";
    address: string;
    displayName: string | null;
    sortOrder: number;
  }>;
  attachments: Array<{
    id: string;
    displayFilename: string;
    sortOrder: number;
    deliveryMode: "attachment" | "secure_file";
    secureExpiryDays: number | null;
    mimeType?: string;
    sizeBytes?: number;
    contentHash?: string;
  }>;
};

export type ComposeSaveStatus = "idle" | "saving" | "saved" | "error";

export type ComposeAttachmentDraft = {
  id: string;
  name: string;
  sizeLabel: string;
  sizeBytes: number;
  kind: "attachment" | "secure_file";
  pendingUpload: boolean;
  uploadStatus: "queued" | "uploading" | "uploaded" | "failed" | "cancelled";
  uploadProgress: number;
  error: string | null;
};

export type ComposeEditorState = {
  draftId: string | null;
  autosaveVersion: number;
  senderIdentityId: string | null;
  mailboxId: string | null;
  to: RecipientChipData[];
  cc: RecipientChipData[];
  bcc: RecipientChipData[];
  subject: string;
  bodyHtml: string;
  attachments: ComposeAttachmentDraft[];
  saveStatus: ComposeSaveStatus;
  saveError: string | null;
  lastSavedAt: string | null;
};

export type ComposeInitialSeed = {
  draftId?: string;
  senderIdentityId?: string;
  mailboxId?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  bodyHtml?: string;
};

export function draftPath(draftId: string): string {
  return `${DRAFTS_PATH}/${encodeURIComponent(draftId)}`;
}

export function draftAttachmentsPath(draftId: string): string {
  return `${draftPath(draftId)}/attachments`;
}

export function draftAttachmentPath(
  draftId: string,
  attachmentId: string,
): string {
  return `${draftAttachmentsPath(draftId)}/${encodeURIComponent(attachmentId)}`;
}

export function draftDiscardPath(draftId: string): string {
  return `${draftPath(draftId)}/discard`;
}

export function resolveDefaultComposeOption(
  options: ComposeContextOption[],
  preferred?: { senderIdentityId?: string; mailboxId?: string },
): ComposeContextOption | null {
  if (options.length === 0) return null;
  if (preferred?.senderIdentityId && preferred?.mailboxId) {
    const match = options.find(
      (option) =>
        option.senderIdentityId === preferred.senderIdentityId &&
        option.mailboxId === preferred.mailboxId,
    );
    if (match) return match;
  }
  if (preferred?.senderIdentityId) {
    const match = options.find(
      (option) => option.senderIdentityId === preferred.senderIdentityId,
    );
    if (match) return match;
  }
  return options[0] ?? null;
}

export function isAuthorizedComposeSelection(
  options: ComposeContextOption[],
  senderIdentityId: string,
  mailboxId: string,
): boolean {
  return options.some(
    (option) =>
      option.senderIdentityId === senderIdentityId &&
      option.mailboxId === mailboxId,
  );
}

export function hasMeaningfulComposeContent(input: {
  subject?: string;
  bodyHtml?: string;
  recipientLists?: RecipientLists;
  attachmentCount?: number;
}): boolean {
  if (input.subject?.trim()) return true;
  if (input.bodyHtml?.replace(/<[^>]+>/g, "").trim()) return true;
  if (input.recipientLists && countUniqueRecipients(input.recipientLists) > 0) {
    return true;
  }
  if ((input.attachmentCount ?? 0) > 0) return true;
  return false;
}

export function buildRecipientLists(state: Pick<ComposeEditorState, "to" | "cc" | "bcc">): RecipientLists {
  return { to: state.to, cc: state.cc, bcc: state.bcc };
}

export function draftDetailToComposeState(item: DraftDetailApiItem): ComposeEditorState {
  const lists = recipientViewsToLists(item.recipients);
  return {
    draftId: item.id,
    autosaveVersion: item.autosaveVersion,
    senderIdentityId: item.senderIdentityId,
    mailboxId: item.mailboxId,
    to: lists.to,
    cc: lists.cc,
    bcc: lists.bcc,
    subject: item.subject,
    bodyHtml: item.bodyHtml ?? "",
    attachments: item.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.displayFilename,
      sizeLabel: formatAttachmentSize(attachment.sizeBytes),
      sizeBytes: attachment.sizeBytes ?? 0,
      kind: attachment.deliveryMode,
      pendingUpload: false,
      uploadStatus: "uploaded" as const,
      uploadProgress: 100,
      error: null,
    })),
    saveStatus: "saved",
    saveError: null,
    lastSavedAt: item.lastSavedAt,
  };
}

export function createEmptyComposeState(seed?: ComposeInitialSeed): ComposeEditorState {
  return {
    draftId: seed?.draftId ?? null,
    autosaveVersion: 0,
    senderIdentityId: seed?.senderIdentityId ?? null,
    mailboxId: seed?.mailboxId ?? null,
    to: seed?.to?.map((email) => ({ id: crypto.randomUUID(), email })) ?? [],
    cc: seed?.cc?.map((email) => ({ id: crypto.randomUUID(), email })) ?? [],
    bcc: seed?.bcc?.map((email) => ({ id: crypto.randomUUID(), email })) ?? [],
    subject: seed?.subject ?? "",
    bodyHtml: seed?.bodyHtml ?? "",
    attachments: [],
    saveStatus: "idle",
    saveError: null,
    lastSavedAt: null,
  };
}

export function buildDraftAutosavePayload(state: ComposeEditorState): {
  senderIdentityId: string;
  mailboxId: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  recipients: ReturnType<typeof recipientListsToApiPayload>;
} {
  if (!state.senderIdentityId || !state.mailboxId) {
    throw new Error("Compose From selection is required before saving");
  }
  const lists = buildRecipientLists(state);
  const plainText = stripHtml(state.bodyHtml);
  return {
    senderIdentityId: state.senderIdentityId,
    mailboxId: state.mailboxId,
    subject: state.subject,
    bodyText: plainText,
    bodyHtml: state.bodyHtml,
    recipients: recipientListsToApiPayload(lists),
  };
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ")
    .trim();
}

export function formatAttachmentSize(sizeBytes?: number): string {
  if (!sizeBytes || sizeBytes <= 0) return "—";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function attachmentDraftFromUploadState(
  attachment: ComposeAttachmentUploadState,
): ComposeAttachmentDraft {
  return {
    id: attachment.serverId ?? attachment.localId,
    name: attachment.name,
    sizeLabel: attachment.sizeLabel,
    sizeBytes: attachment.sizeBytes,
    kind: attachment.kind,
    pendingUpload:
      attachment.uploadStatus === "queued" ||
      attachment.uploadStatus === "uploading",
    uploadStatus: attachment.uploadStatus,
    uploadProgress: attachment.uploadProgress,
    error: attachment.error,
  };
}

export function attachmentsFromUploadStates(
  attachments: ComposeAttachmentUploadState[],
): ComposeAttachmentDraft[] {
  return attachments.map(attachmentDraftFromUploadState);
}

export function composeMobileRootClass(variant: "embedded-mobile" | "floating-desktop"): string {
  return variant === "embedded-mobile"
    ? "mail-compose-mobile flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    : "mail-compose-desktop flex min-h-0 flex-1 flex-col overflow-hidden";
}

export function recipientEmailsForSummary(state: Pick<ComposeEditorState, "to" | "cc" | "bcc">): string[] {
  return chipsToEmails([...state.to, ...state.cc, ...state.bcc]);
}
