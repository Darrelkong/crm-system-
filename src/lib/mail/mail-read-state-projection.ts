import type { MailMessageReadState } from "../../../drizzle/schema/mail-message-read-states";

export type MailMessageReadStateView = {
  messageId: string;
  isRead: boolean;
  isImportantPersonal: boolean;
  readAt: string | null;
};

export type ProjectedMessageReadState = {
  isRead: boolean;
  isUnread: boolean;
  isImportantPersonal: boolean;
  readAt: string | null;
};

/**
 * Shared read-state semantics for list/detail projection and mutations.
 * No row => unread and not personally important.
 */
export function projectMessageReadState(
  readState: MailMessageReadState | null | undefined,
): ProjectedMessageReadState {
  const isRead = readState != null && readState.isRead === 1;
  return {
    isRead,
    isUnread: !isRead,
    isImportantPersonal: readState?.isImportantPersonal === 1,
    readAt: isRead ? readState?.readAt ?? null : null,
  };
}

export function toMailMessageReadStateView(
  messageId: string,
  readState: MailMessageReadState | null | undefined,
): MailMessageReadStateView {
  const projected = projectMessageReadState(readState);
  return {
    messageId,
    isRead: projected.isRead,
    isImportantPersonal: projected.isImportantPersonal,
    readAt: projected.readAt,
  };
}
