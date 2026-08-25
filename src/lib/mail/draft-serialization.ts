import type { MailDraft } from "../../../drizzle/schema/mail-drafts";
import type {
  MailDeliveryMode,
  MailDraftAttachment,
} from "../../../drizzle/schema/mail-draft-attachments";
import type { MailDraftRecipient } from "../../../drizzle/schema/mail-draft-recipients";
import { sanitizeOptionalOutboundBodyHtml } from "@/lib/mail/outbound-body-html-sanitizer";
import type { SafeDraftCustomerAssociationView } from "@/lib/mail/mail-customer-association-service";

export type SafeDraftView = {
  id: string;
  authorUserId: string;
  mailboxId: string | null;
  senderIdentityId: string | null;
  subject: string;
  bodyText: string;
  /** Server-sanitized working HTML safe for Compose reload. */
  bodyHtml: string | null;
  hasHtml: boolean;
  sensitivity: MailDraft["sensitivity"];
  composeMode: MailDraft["composeMode"];
  replyToMessageId: string | null;
  autosaveVersion: number;
  lastSavedAt: string;
  discardedAt: string | null;
  createdAt: string;
  updatedAt: string;
  customerAssociation?: SafeDraftCustomerAssociationView | null;
};

export type SafeDraftRecipientView = {
  id: string;
  recipientType: MailDraftRecipient["recipientType"];
  address: string;
  displayName: string | null;
  sortOrder: number;
};

export type ClientDraftDeliveryMode = "attachment" | "secure_file";

export type SafeDraftAttachmentView = {
  id: string;
  displayFilename: string;
  sortOrder: number;
  deliveryMode: ClientDraftDeliveryMode;
  secureExpiryDays: number | null;
  mimeType?: string;
  sizeBytes?: number;
  contentHash?: string;
};

export function toClientDeliveryMode(
  mode: MailDeliveryMode,
): ClientDraftDeliveryMode {
  return mode === "direct_attachment" ? "attachment" : "secure_file";
}

export function toSafeDraftView(draft: MailDraft): SafeDraftView {
  const bodyHtml = sanitizeOptionalOutboundBodyHtml(draft.bodyHtml);
  return {
    id: draft.id,
    authorUserId: draft.authorUserId,
    mailboxId: draft.mailboxId,
    senderIdentityId: draft.senderIdentityId,
    subject: draft.subject,
    bodyText: draft.bodyText,
    bodyHtml,
    hasHtml: Boolean(bodyHtml),
    sensitivity: draft.sensitivity,
    composeMode: draft.composeMode,
    replyToMessageId: draft.replyToMessageId,
    autosaveVersion: draft.autosaveVersion,
    lastSavedAt: draft.lastSavedAt,
    discardedAt: draft.discardedAt,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

export function toSafeDraftRecipientView(
  recipient: MailDraftRecipient,
): SafeDraftRecipientView {
  return {
    id: recipient.id,
    recipientType: recipient.recipientType,
    address: recipient.address,
    displayName: recipient.displayName,
    sortOrder: recipient.sortOrder,
  };
}

export function toSafeDraftAttachmentView(
  attachment: MailDraftAttachment,
  stored?: { mimeType: string; sizeBytes: number; contentHash?: string },
): SafeDraftAttachmentView {
  return {
    id: attachment.id,
    displayFilename: attachment.displayFilename,
    sortOrder: attachment.sortOrder,
    deliveryMode: toClientDeliveryMode(attachment.deliveryMode),
    secureExpiryDays: attachment.secureExpiryDays,
    mimeType: stored?.mimeType,
    sizeBytes: stored?.sizeBytes,
    contentHash: stored?.contentHash,
  };
}
