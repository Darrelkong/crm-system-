export type MockTeamMemberId = "admin" | "staff-a" | "staff-b";

export type SharedProcessingStatus =
  | "unclaimed"
  | "in_progress"
  | "waiting_customer"
  | "completed";

export type SharedViewFilter =
  | "all"
  | "unclaimed"
  | "mine"
  | "waiting_customer"
  | "completed";

/** Prototype QA: A = full, B = read+reply, C = read only */
export type SharedPermissionLevel = "full" | "reply" | "read_only";

export type SharedMailboxPermission = {
  mailboxId: string;
  userId: MockTeamMemberId;
  canRead: boolean;
  canReply: boolean;
  canSend: boolean;
};

export type MailInternalNote = {
  id: string;
  messageId: string;
  authorId: MockTeamMemberId;
  content: string;
  mentions: MockTeamMemberId[];
  createdAt: string;
};

export type MailActivityType =
  | "claimed"
  | "status_changed"
  | "transferred"
  | "note_added"
  | "completed";

export type MailActivityEvent = {
  id: string;
  messageId: string;
  type: MailActivityType;
  actorId: MockTeamMemberId;
  timestamp: string;
  metadata?: {
    fromAssigneeId?: MockTeamMemberId | null;
    toAssigneeId?: MockTeamMemberId | null;
    status?: SharedProcessingStatus;
    notePreview?: string;
  };
};

export type MockMentionNotification = {
  id: string;
  messageId: string;
  mailboxDisplayName: string;
  subjectPreview: string;
  authorId: MockTeamMemberId;
  targetUserId: MockTeamMemberId;
  createdAt: string;
};

export type MailTemplate = {
  id: string;
  category: string;
  title: string;
  subject?: string;
  body: string;
};

export const MOCK_SHARED_MAILBOX_ID = "hello@echfronthk.com";
