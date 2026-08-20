import type {
  MockTeamMemberId,
  SharedProcessingStatus,
} from "./shared-mailbox-types";

export type MailPrototypeScenario =
  | "admin"
  | "staff_single"
  | "staff_multiple"
  | "staff_b"
  | "staff_no_access"
  | "shared_mailbox";

export type MailFolderId =
  | "inbox"
  | "pending"
  | "drafts"
  | "pending_approval"
  | "returned"
  | "sent"
  | "trash"
  | "pending_my_approval";

export type MailAssignmentState =
  | "none"
  | "unassigned"
  | "assigned_to_me"
  | "assigned_to_other";

export type MailMessageStatus =
  | "inbox"
  | "pending"
  | "draft"
  | "pending_approval"
  | "returned"
  | "sent"
  | "trash"
  | "pending_my_approval";

export type MailAttachmentKind = "attachment" | "secure_file";

export type MailAttachment = {
  id: string;
  name: string;
  sizeLabel: string;
  kind: MailAttachmentKind;
};

export type MailMailbox = {
  address: string;
  label: "personal" | "shared";
  displayName?: string;
  autoReplyEnabled?: boolean;
};

export type MailCustomerMatch = {
  id: string;
  name: string;
} | null;

export type MailComposeMode =
  | "new"
  | "reply"
  | "reply_all"
  | "forward"
  | "edit_approval";

export type MailSensitivity = "normal" | "sensitive" | "restricted";

export type MailDeliveryStatus =
  | "sending"
  | "sent"
  | "delivered"
  | "deferred"
  | "bounced"
  | "failed";

export type MailQuotedOriginal = {
  fromName: string;
  fromEmail: string;
  sentAt: string;
  subject: string;
  to: string[];
  body: string;
};

export type MailApprovalSnapshot = {
  subject: string;
  body: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
};

export type MailCustomerAssociation = {
  id: string;
  name: string;
} | null;

export type MailMessage = {
  id: string;
  folder: MailMessageStatus;
  mailbox: string;
  fromName: string;
  fromEmail: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  preview: string;
  body: string;
  sentAt: string;
  isUnread: boolean;
  hasAttachment: boolean;
  attachments: MailAttachment[];
  customerMatch: MailCustomerMatch;
  manualCustomerAssociation?: MailCustomerAssociation;
  assignment: MailAssignmentState;
  assignedToName?: string;
  submittedByName?: string;
  submittedAt?: string;
  returnReason?: string;
  isImportant?: boolean;
  sensitivity?: MailSensitivity;
  deliveryStatus?: MailDeliveryStatus;
  deliveryDetail?: string;
  draftUpdatedAt?: string;
  approvalOriginal?: MailApprovalSnapshot;
  adminEdited?: boolean;
  processingStatus?: SharedProcessingStatus;
  assigneeId?: MockTeamMemberId | null;
  readByUserIds?: MockTeamMemberId[];
};

export type MailStatusSummary = {
  unread: number;
  pendingApproval?: number;
  returned?: number;
  pendingMyApproval?: number;
  sendErrors?: number;
};

export type { MockTeamMemberId, SharedProcessingStatus };
