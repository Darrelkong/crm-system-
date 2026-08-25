import type { MailMessage } from "../../../drizzle/schema/mail-messages";
import type { MailMessageAttachment } from "../../../drizzle/schema/mail-message-attachments";
import type { MailMessageBody } from "../../../drizzle/schema/mail-message-bodies";
import type { MailMessageReadState } from "../../../drizzle/schema/mail-message-read-states";
import type { MailSecurityScanStatus } from "../../../drizzle/schema/mail-stored-files";
import type { FilterableMailRecipient } from "@/lib/mail/message-read-permissions";
import type { SafeDraftCustomerAssociationView } from "@/lib/mail/mail-customer-association-service";
import { isMailAttachmentDownloadAvailable } from "@/lib/mail/mail-attachment-download-availability";
import { projectMessageReadState } from "@/lib/mail/mail-read-state-projection";
import type { MailThreadSummaryView } from "@/lib/mail/mail-thread-service";

export type MailMessageListSenderView = {
  address: string;
  displayName: string | null;
};

/** Safe list row — no body, recipients, or CRM fields. */
export type MailMessageListView = {
  id: string;
  threadId: string;
  mailboxId: string;
  direction: MailMessage["direction"];
  sender: MailMessageListSenderView;
  subject: string;
  preview: string;
  timestamp: string;
  isUnread: boolean;
  isImportantPersonal: boolean;
  hasAttachments: boolean;
  attachmentCount: number;
};

export type MailMessageDetailRecipientView = {
  recipientType: FilterableMailRecipient["recipientType"];
  address: string;
  displayName: string | null;
  sortOrder: number;
};

export type MailMessageAttachmentMetadataView = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  deliveryMode: MailMessageAttachment["deliveryMode"];
  sortOrder: number;
  downloadAvailable: boolean;
};

/** Safe detail view — CRM association resolved server-side with independent CRM gate. */
export type MailMessageDetailView = {
  id: string;
  threadId: string;
  mailboxId: string;
  direction: MailMessage["direction"];
  composeMode: MailMessage["composeMode"];
  subject: string;
  sender: MailMessageListSenderView;
  recipients: MailMessageDetailRecipientView[];
  bodyText: string;
  bodyHtml: string | null;
  quotedText: string | null;
  quotedHtml: string | null;
  receivedAt: string | null;
  sentAt: string | null;
  isUnread: boolean;
  isImportantPersonal: boolean;
  attachments: MailMessageAttachmentMetadataView[];
  thread: MailThreadSummaryView;
  customerAssociation: SafeDraftCustomerAssociationView | null;
};

export function toMailMessageListSenderView(
  message: Pick<MailMessage, "fromAddress" | "fromDisplayName">,
): MailMessageListSenderView {
  return {
    address: message.fromAddress,
    displayName: message.fromDisplayName,
  };
}

export function toMailMessageListView(input: {
  message: MailMessage;
  timestamp: string;
  readState: MailMessageReadState | null;
  attachmentCount: number;
}): MailMessageListView {
  const projected = projectMessageReadState(input.readState);
  return {
    id: input.message.id,
    threadId: input.message.threadId,
    mailboxId: input.message.mailboxId,
    direction: input.message.direction,
    sender: toMailMessageListSenderView(input.message),
    subject: input.message.subject,
    preview: input.message.previewText,
    timestamp: input.timestamp,
    isUnread: projected.isUnread,
    isImportantPersonal: projected.isImportantPersonal,
    hasAttachments: input.attachmentCount > 0,
    attachmentCount: input.attachmentCount,
  };
}

export function toMailMessageDetailRecipientView(
  recipient: FilterableMailRecipient,
): MailMessageDetailRecipientView {
  return {
    recipientType: recipient.recipientType,
    address: recipient.address,
    displayName: recipient.displayName,
    sortOrder: recipient.sortOrder,
  };
}

export function toMailMessageAttachmentMetadataView(input: {
  attachment: MailMessageAttachment;
  securityScanStatus: MailSecurityScanStatus;
}): MailMessageAttachmentMetadataView {
  const { attachment, securityScanStatus } = input;
  return {
    id: attachment.id,
    filename: attachment.displayFilename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    deliveryMode: attachment.deliveryMode,
    sortOrder: attachment.sortOrder,
    downloadAvailable: isMailAttachmentDownloadAvailable({
      deliveryMode: attachment.deliveryMode,
      securityScanStatus,
    }),
  };
}

export function toMailMessageDetailView(input: {
  message: MailMessage;
  body: MailMessageBody;
  recipients: MailMessageDetailRecipientView[];
  attachments: MailMessageAttachmentMetadataView[];
  thread: MailThreadSummaryView;
  readState: MailMessageReadState | null;
  customerAssociation?: SafeDraftCustomerAssociationView | null;
}): MailMessageDetailView {
  const projected = projectMessageReadState(input.readState);
  return {
    id: input.message.id,
    threadId: input.message.threadId,
    mailboxId: input.message.mailboxId,
    direction: input.message.direction,
    composeMode: input.message.composeMode,
    subject: input.message.subject,
    sender: toMailMessageListSenderView(input.message),
    recipients: input.recipients,
    bodyText: input.body.bodyText,
    bodyHtml: input.body.bodyHtmlSanitized,
    quotedText: input.body.quotedText,
    quotedHtml: input.body.quotedHtmlSanitized,
    receivedAt: input.message.receivedAt,
    sentAt: input.message.sentAt,
    isUnread: projected.isUnread,
    isImportantPersonal: projected.isImportantPersonal,
    attachments: input.attachments,
    thread: input.thread,
    customerAssociation: input.customerAssociation ?? null,
  };
}
