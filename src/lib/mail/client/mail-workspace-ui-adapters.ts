import { MailReadApiError } from "@/lib/mail/client/mail-read-api-errors";
import type {
  AccessibleMailboxView,
  MailCustomerAssociationView,
  MailMessageDetailView,
  MailMessageListView,
  MailReadFolder,
} from "@/lib/mail/client/mail-read-types";
import {
  pickMailCrmContextSafeFields,
  type MailCrmContextAssociation,
} from "@/lib/mail/crm/mail-crm-context-model";
import { formatAttachmentSize } from "@/lib/mail/client/draft-management";
import type { DraftApiItem } from "@/lib/mail/client/draft-management";
import {
  deriveDraftListPreview,
  formatDraftRecipientSummary,
} from "@/lib/mail/client/draft-management";
import type { MailFolderId } from "@/lib/mail/prototype/types";
import type { MailMessage } from "@/lib/mail/prototype/types";

export type MailListRowPresentation = {
  id: string;
  fromName: string;
  subject: string;
  preview: string;
  sentAt: string;
  isUnread: boolean;
  isImportant: boolean;
  hasAttachment: boolean;
  deliveryStatus?: MailMessage["deliveryStatus"];
  processingStatus?: MailMessage["processingStatus"];
  assigneeId?: MailMessage["assigneeId"];
  draftRecipientCount?: number;
  draftRecipientSummary?: string | null;
};

export type MailSidebarMailboxPresentation = {
  id: string;
  address: string;
  displayName: string | null;
  mailboxType: "personal" | "shared";
};

export type MailboxSidebarSectionLabelKey =
  | "mail.sidebar.mailboxes"
  | "mail.sidebar.sharedMailboxes";

/** Desktop sidebar / mobile switcher rendering model derived from persisted mailboxType. */
export type MailboxSidebarSections = {
  showSection: boolean;
  sectionLabelKey: MailboxSidebarSectionLabelKey | null;
  personalMailboxes: MailSidebarMailboxPresentation[];
  sharedMailboxes: MailSidebarMailboxPresentation[];
};

export function resolveMailboxSidebarSections(
  mailboxes: readonly MailSidebarMailboxPresentation[],
): MailboxSidebarSections {
  const personalMailboxes = mailboxes.filter(
    (mailbox) => mailbox.mailboxType === "personal",
  );
  const sharedMailboxes = mailboxes.filter(
    (mailbox) => mailbox.mailboxType === "shared",
  );
  const personalCount = personalMailboxes.length;
  const sharedCount = sharedMailboxes.length;

  if (personalCount === 1 && sharedCount === 0) {
    return {
      showSection: false,
      sectionLabelKey: null,
      personalMailboxes,
      sharedMailboxes,
    };
  }

  if (personalCount === 0 && sharedCount > 0) {
    return {
      showSection: true,
      sectionLabelKey: "mail.sidebar.sharedMailboxes",
      personalMailboxes,
      sharedMailboxes,
    };
  }

  if (personalCount + sharedCount === 0) {
    return {
      showSection: false,
      sectionLabelKey: null,
      personalMailboxes,
      sharedMailboxes,
    };
  }

  return {
    showSection: true,
    sectionLabelKey: "mail.sidebar.mailboxes",
    personalMailboxes,
    sharedMailboxes,
  };
}

export function adaptPrototypeSidebarMailbox(input: {
  address: string;
  displayName?: string;
  label: "personal" | "shared";
}): MailSidebarMailboxPresentation {
  return {
    id: input.address,
    address: input.address,
    displayName: input.displayName ?? null,
    mailboxType: input.label,
  };
}

export const PRODUCTION_MAIL_READ_FOLDERS: readonly {
  id: MailReadFolder;
  labelKey: string;
}[] = [
  { id: "inbox", labelKey: "mail.folders.inbox" },
  { id: "sent", labelKey: "mail.folders.sent" },
  { id: "trash", labelKey: "mail.folders.trash" },
];

export type ProductionWorkflowFolder = {
  id: "drafts" | "pending_approval";
  labelKey: string;
  reviewerOnly?: boolean;
};

export const PRODUCTION_WORKFLOW_FOLDERS: readonly ProductionWorkflowFolder[] = [
  { id: "drafts", labelKey: "mail.folders.drafts" },
  {
    id: "pending_approval",
    labelKey: "mail.folders.waitingApproval",
  },
];

export function resolveApprovalWorkspaceListScope(
  canReview: boolean,
): "reviewer" | "author" {
  return canReview ? "reviewer" : "author";
}

export function filterVisibleWorkflowFolders(
  canReview: boolean,
): ProductionWorkflowFolder[] {
  return PRODUCTION_WORKFLOW_FOLDERS.filter(
    (folder) => !folder.reviewerOnly || canReview,
  );
}

export function resolveWorkflowFolderLabelKey(
  folderId: string,
  canReview: boolean,
): string {
  if (folderId === "pending_approval") {
    return canReview
      ? "mail.folders.pendingMyApproval"
      : "mail.folders.waitingApproval";
  }
  const folder = PRODUCTION_WORKFLOW_FOLDERS.find((item) => item.id === folderId);
  return folder?.labelKey ?? "mail.folders.inbox";
}

const PRODUCTION_FOLDER_IDS = new Set<MailReadFolder>(["inbox", "sent", "trash"]);

export function isProductionWorkflowFolder(
  folder: string,
): folder is "drafts" | "pending_approval" {
  return folder === "drafts" || folder === "pending_approval";
}

export function resolveProductionFolderLabelKey(
  folder: string,
  canReview = false,
): string {
  const readFolder = PRODUCTION_MAIL_READ_FOLDERS.find((item) => item.id === folder);
  if (readFolder) {
    return readFolder.labelKey;
  }
  if (isProductionWorkflowFolder(folder)) {
    return resolveWorkflowFolderLabelKey(folder, canReview);
  }
  return "mail.folders.inbox";
}

export function isProductionMailReadFolder(
  folder: string,
): folder is MailReadFolder {
  return PRODUCTION_FOLDER_IDS.has(folder as MailReadFolder);
}

export function isPrototypeWorkflowFolder(folder: MailFolderId): boolean {
  return !isProductionMailReadFolder(folder);
}

export function adaptAccessibleMailbox(
  mailbox: AccessibleMailboxView,
): MailSidebarMailboxPresentation {
  return {
    id: mailbox.id,
    address: mailbox.address,
    displayName: mailbox.displayName,
    mailboxType: mailbox.mailboxType,
  };
}

export function adaptProductionListRow(
  message: MailMessageListView,
): MailListRowPresentation {
  return {
    id: message.id,
    fromName: message.sender.displayName ?? message.sender.address,
    subject: message.subject,
    preview: message.preview,
    sentAt: message.timestamp,
    isUnread: message.isUnread,
    isImportant: message.isImportantPersonal,
    hasAttachment: message.hasAttachments,
  };
}

export function adaptProductionDraftListRow(
  draft: DraftApiItem,
): MailListRowPresentation {
  const toRecipients = draft.toRecipients?.filter(
    (recipient) => recipient.recipientType === "to",
  );
  return {
    id: draft.id,
    fromName: "",
    subject: draft.subject,
    preview: deriveDraftListPreview({
      bodyText: draft.bodyText,
      bodyHtml: draft.bodyHtml,
    }),
    sentAt: draft.updatedAt,
    isUnread: false,
    isImportant: false,
    hasAttachment: false,
    draftRecipientCount: toRecipients?.length ?? 0,
    draftRecipientSummary: formatDraftRecipientSummary(toRecipients),
  };
}

export function adaptPrototypeListRow(message: MailMessage): MailListRowPresentation {
  return {
    id: message.id,
    fromName: message.fromName,
    subject: message.subject,
    preview: message.preview,
    sentAt: message.sentAt,
    isUnread: false,
    isImportant: message.isImportant ?? false,
    hasAttachment: message.hasAttachment,
    deliveryStatus: message.deliveryStatus,
    processingStatus: message.processingStatus,
    assigneeId: message.assigneeId,
    draftRecipientCount: message.to.length,
  };
}

export function filterProductionListRows(
  rows: MailListRowPresentation[],
  searchQuery: string,
): MailListRowPresentation[] {
  const query = searchQuery.trim().toLowerCase();
  if (!query) {
    return rows;
  }
  return rows.filter(
    (row) =>
      row.fromName.toLowerCase().includes(query) ||
      row.subject.toLowerCase().includes(query) ||
      row.preview.toLowerCase().includes(query),
  );
}

export function isProductionSearchActive(searchQuery: string): boolean {
  return searchQuery.trim().length > 0;
}

export type ProductionListEmptyState =
  | "loading"
  | "error"
  | "folder-empty"
  | "search-empty";

export function resolveProductionListEmptyState(input: {
  isLoadingMessages: boolean;
  loadedRowCount: number;
  filteredRowCount: number;
  searchQuery: string;
  hasError: boolean;
}): ProductionListEmptyState | null {
  if (input.isLoadingMessages && input.loadedRowCount === 0) {
    return "loading";
  }
  if (input.hasError && input.loadedRowCount === 0) {
    return "error";
  }
  if (input.filteredRowCount > 0) {
    return null;
  }
  if (isProductionSearchActive(input.searchQuery) && input.loadedRowCount > 0) {
    return "search-empty";
  }
  if (input.loadedRowCount === 0) {
    return "folder-empty";
  }
  return "search-empty";
}

export function resolveProductionListEmptyMessageKey(
  state: ProductionListEmptyState,
): string {
  switch (state) {
    case "loading":
      return "common.loading";
    case "error":
      return "mail.status.accessUnavailable";
    case "search-empty":
      return "mail.list.searchEmpty";
    case "folder-empty":
      return "mail.list.empty";
  }
}

export function resolveMailReadErrorMessageKey(error: MailReadApiError): string {
  if (error.status === 401 || error.status === 403) {
    return "mail.status.accessUnavailable";
  }
  if (error.status === 404) {
    return "common.loadFailed";
  }
  return "common.loadFailed";
}

export function shouldRenderPrototypeMessageDetail(
  source: "prototype" | "production",
): boolean {
  return source === "prototype";
}

export type MailDetailRecipientPresentation = {
  type: "to" | "cc" | "bcc";
  addresses: string[];
};

export type MailDetailAttachmentPresentation = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sizeLabel: string;
  deliveryMode: "direct_attachment" | "secure_file";
  downloadAvailable: boolean;
  downloadable?: boolean;
  previewable?: boolean;
  previewType?: "image" | "pdf" | null;
};

export type MailDetailPresentation = {
  id: string;
  subject: string;
  senderName: string;
  senderAddress: string;
  recipientLines: MailDetailRecipientPresentation[];
  timestamp: string;
  isImportant: boolean;
  isUnread: boolean;
  bodyHtml: string | null;
  bodyText: string;
  quotedHtml: string | null;
  quotedText: string | null;
  attachments: MailDetailAttachmentPresentation[];
};

/** API `bodyHtml` is mapped from persisted `bodyHtmlSanitized` only. */
export const PRODUCTION_BODY_HTML_USES_SANITIZED_FIELD = true;

/** API `quotedHtml` is mapped from persisted `quotedHtmlSanitized` only. */
export const PRODUCTION_QUOTED_HTML_USES_SANITIZED_FIELD = true;

export function formatProductionRecipientLabel(
  recipient: MailMessageDetailView["recipients"][number],
): string {
  return recipient.displayName
    ? `${recipient.displayName} <${recipient.address}>`
    : recipient.address;
}

export function groupProductionRecipientLines(
  detail: MailMessageDetailView,
): MailDetailRecipientPresentation[] {
  const groups: Array<"to" | "cc" | "bcc"> = ["to", "cc", "bcc"];
  return groups
    .map((type) => ({
      type,
      addresses: detail.recipients
        .filter((recipient) => recipient.recipientType === type)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map(formatProductionRecipientLabel),
    }))
    .filter((group) => group.addresses.length > 0);
}

export function resolveProductionDetailTimestamp(
  detail: MailMessageDetailView,
): string {
  return detail.sentAt ?? detail.receivedAt ?? "";
}

export function canRenderProductionQuotedHtml(
  quotedHtml: string | null,
): boolean {
  return PRODUCTION_QUOTED_HTML_USES_SANITIZED_FIELD && Boolean(quotedHtml?.trim());
}

export function adaptProductionDetailView(
  detail: MailMessageDetailView,
): MailDetailPresentation {
  return {
    id: detail.id,
    subject: detail.subject,
    senderName: detail.sender.displayName ?? detail.sender.address,
    senderAddress: detail.sender.address,
    recipientLines: groupProductionRecipientLines(detail),
    timestamp: resolveProductionDetailTimestamp(detail),
    isImportant: detail.isImportantPersonal,
    isUnread: detail.isUnread,
    bodyHtml: detail.bodyHtml,
    bodyText: detail.bodyText,
    quotedHtml: detail.quotedHtml,
    quotedText: detail.quotedText,
    attachments: detail.attachments
      .slice()
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        sizeBytes: attachment.sizeBytes,
        mimeType: attachment.mimeType,
        sizeLabel: formatAttachmentSize(attachment.sizeBytes),
        deliveryMode: attachment.deliveryMode,
        downloadAvailable: attachment.downloadAvailable,
        downloadable: attachment.downloadable ?? attachment.downloadAvailable,
        previewable: attachment.previewable,
        previewType: attachment.previewType,
      })),
  };
}

/**
 * Maps Production detail CRM association into the panel-safe contract.
 * No frontend permission logic; null in → null out.
 */
export function adaptProductionCustomerAssociation(
  association: MailCustomerAssociationView | null | undefined,
): MailCrmContextAssociation | null {
  if (!association?.customerId?.trim()) {
    return null;
  }

  return pickMailCrmContextSafeFields({
    customerId: association.customerId,
    customerCode: association.customerCode,
    name: association.name,
    salesStage: association.salesStage,
    ownerName: association.ownerName,
    associationType: association.associationType,
  });
}

export function shouldRenderProductionCrmContextPanel(
  association: MailCustomerAssociationView | null | undefined,
): boolean {
  return adaptProductionCustomerAssociation(association) !== null;
}

export function isProductionDetailReady(input: {
  selectedMessageId: string | null;
  selectedMessage: MailMessageDetailView | null;
  isLoadingDetail: boolean;
}): input is {
  selectedMessageId: string;
  selectedMessage: MailMessageDetailView;
  isLoadingDetail: false;
} {
  return (
    !input.isLoadingDetail &&
    input.selectedMessageId !== null &&
    input.selectedMessage !== null &&
    input.selectedMessage.id === input.selectedMessageId
  );
}

export function shouldApplyProductionDetailResponse(input: {
  requestMessageId: string;
  requestSequence: number;
  activeSequence: number;
  selectedMessageId: string | null;
}): boolean {
  return (
    input.requestSequence === input.activeSequence &&
    input.selectedMessageId === input.requestMessageId
  );
}
