import type {
  MailActivityEvent,
  MailInternalNote,
  MailTemplate,
  MockTeamMemberId,
  SharedMailboxPermission,
} from "./shared-mailbox-types";
import { MOCK_SHARED_MAILBOX_ID } from "./shared-mailbox-types";

export const MOCK_TEAM_MEMBERS: Record<
  MockTeamMemberId,
  { id: MockTeamMemberId; displayName: string }
> = {
  admin: { id: "admin", displayName: "Daniel" },
  "staff-a": { id: "staff-a", displayName: "Employee A" },
  "staff-b": { id: "staff-b", displayName: "Employee B" },
};

export const MOCK_SHARED_PERMISSIONS: SharedMailboxPermission[] = [
  {
    mailboxId: MOCK_SHARED_MAILBOX_ID,
    userId: "admin",
    canRead: true,
    canReply: true,
    canSend: true,
  },
  {
    mailboxId: MOCK_SHARED_MAILBOX_ID,
    userId: "staff-a",
    canRead: true,
    canReply: true,
    canSend: true,
  },
  {
    mailboxId: MOCK_SHARED_MAILBOX_ID,
    userId: "staff-b",
    canRead: true,
    canReply: true,
    canSend: true,
  },
];

export const MOCK_MAIL_TEMPLATES: MailTemplate[] = [
  {
    id: "tpl-bank-1",
    category: "銀行",
    title: "開戶資料提醒",
    subject: "Bank account opening — documents required",
    body: "Dear Customer,\n\nPlease provide the following documents for your bank account opening:\n\n- Passport copy\n- Proof of address\n\nBest regards,\nECHFRONT Team",
  },
  {
    id: "tpl-bank-2",
    category: "銀行",
    title: "補充資料通知",
    body: "Dear Customer,\n\nWe need additional information to proceed with your application. Please reply with the requested details at your earliest convenience.\n\nThank you,\nECHFRONT Team",
  },
  {
    id: "tpl-cs-1",
    category: "客戶服務",
    title: "已收到資料",
    subject: "We have received your documents",
    body: "Dear Customer,\n\nWe confirm receipt of your documents and will review them shortly.\n\nECHFRONT Client Service",
  },
  {
    id: "tpl-cs-2",
    category: "客戶服務",
    title: "處理中通知",
    body: "Dear Customer,\n\nYour request is currently being processed. We will update you once there is progress.\n\nECHFRONT Client Service",
  },
];

export function createInitialInternalNotes(): MailInternalNote[] {
  return [
    {
      id: "note-1",
      messageId: "msg-4",
      authorId: "staff-a",
      content: "客戶已補交護照，等銀行確認。@Employee B 請留意後續跟進。",
      mentions: ["staff-b"],
      createdAt: "2026-08-17T15:00:00+08:00",
    },
  ];
}

export function createInitialActivityEvents(): MailActivityEvent[] {
  return [
    {
      id: "act-1",
      messageId: "msg-4",
      type: "claimed",
      actorId: "staff-a",
      timestamp: "2026-08-17T14:25:00+08:00",
    },
    {
      id: "act-2",
      messageId: "msg-4",
      type: "note_added",
      actorId: "staff-a",
      timestamp: "2026-08-17T15:00:00+08:00",
      metadata: { notePreview: "客戶已補交護照…" },
    },
    {
      id: "act-3",
      messageId: "msg-5",
      type: "claimed",
      actorId: "staff-b",
      timestamp: "2026-08-16T11:30:00+08:00",
    },
    {
      id: "act-4",
      messageId: "msg-shared-waiting",
      type: "status_changed",
      actorId: "staff-a",
      timestamp: "2026-08-18T08:00:00+08:00",
      metadata: { status: "waiting_customer" },
    },
  ];
}
