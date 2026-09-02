export type MailReadFolder = "inbox" | "sent" | "trash";

/** Production workspace folders including workflow views backed by non-message APIs. */
export type MailWorkspaceFolder = MailReadFolder | "drafts" | "pending_approval";

export type MailReadAccessMode = "member" | "global_read";

export type MailCustomerAssociationView = {
  customerId: string;
  customerCode: string | null;
  name: string;
  salesStage: string;
  ownerName: string | null;
  associationType: "manual" | "auto_match";
};

export type AccessibleMailboxPermissionsView = {
  canRead: boolean;
  canReply: boolean;
  canSend: boolean;
};

export type AccessibleMailboxView = {
  id: string;
  address: string;
  displayName: string | null;
  mailboxType: "personal" | "shared";
  accessMode: MailReadAccessMode;
  permissions: AccessibleMailboxPermissionsView;
};

export type MailMessageListSenderView = {
  address: string;
  displayName: string | null;
};

export type MailMessageListView = {
  id: string;
  threadId: string;
  mailboxId: string;
  direction: "inbound" | "outbound";
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
  recipientType: "to" | "cc" | "bcc";
  address: string;
  displayName: string | null;
  sortOrder: number;
};

export type MailMessageAttachmentMetadataView = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  deliveryMode: "direct_attachment" | "secure_file";
  sortOrder: number;
  downloadAvailable: boolean;
  downloadable: boolean;
  previewable: boolean;
  previewType: "image" | "pdf" | null;
};

export type MailThreadSummaryView = {
  id: string;
  mailboxId: string;
  subjectNormalized: string | null;
  messageCount: number;
  latestMessageAt: string;
};

export type MailMessageDetailView = {
  id: string;
  threadId: string;
  mailboxId: string;
  direction: "inbound" | "outbound";
  composeMode: "new" | "reply" | "reply_all" | "forward" | null;
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
  customerAssociation: MailCustomerAssociationView | null;
};

export type MailThreadView = {
  thread: MailThreadSummaryView;
  items: MailMessageListView[];
};

export type MailReadStateView = {
  messageId: string;
  isRead: boolean;
  isImportantPersonal: boolean;
  readAt: string | null;
};

export type MailMessageListPage = {
  items: MailMessageListView[];
  nextCursor: string | null;
};

export type MailReadStatePatch = {
  isRead?: boolean;
  isImportantPersonal?: boolean;
};

export type FetchMessagesInput = {
  mailboxId: string;
  folder: MailReadFolder;
  cursor?: string | null;
  limit?: number;
};

export type FetchMessageDetailInput = {
  messageId: string;
  folder?: MailReadFolder;
};

export type FetchThreadInput = {
  threadId: string;
  mailboxId: string;
};

export type UpdateMessageReadStateInput = {
  messageId: string;
  patch: MailReadStatePatch;
  folder?: MailReadFolder;
};
