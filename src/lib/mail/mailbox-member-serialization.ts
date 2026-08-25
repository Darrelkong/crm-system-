import type { MailMailboxMember } from "../../../drizzle/schema/mail-mailbox-members";

export type MailboxMemberPermissionFlags = {
  canRead: boolean;
  canReply: boolean;
  canSend: boolean;
  canAssign: boolean;
  canManageProcessing: boolean;
  canAddInternalNote: boolean;
};

export type SafeMailboxMemberView = MailboxMemberPermissionFlags & {
  id: string;
  mailboxId: string;
  userId: string;
  grantedBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export function toSafeMailboxMemberView(
  member: MailMailboxMember,
): SafeMailboxMemberView {
  return {
    id: member.id,
    mailboxId: member.mailboxId,
    userId: member.userId,
    canRead: member.canRead === 1,
    canReply: member.canReply === 1,
    canSend: member.canSend === 1,
    canAssign: member.canAssign === 1,
    canManageProcessing: member.canManageProcessing === 1,
    canAddInternalNote: member.canAddInternalNote === 1,
    grantedBy: member.grantedBy,
    revokedAt: member.revokedAt,
    revokedBy: member.revokedBy,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  };
}

export type MailboxMemberRoleLabel = "full" | "reply" | "read_only" | "custom";

export function deriveMailboxMemberRoleLabel(
  member: MailboxMemberPermissionFlags,
): MailboxMemberRoleLabel {
  if (
    member.canRead &&
    member.canReply &&
    member.canSend &&
    member.canAssign &&
    member.canManageProcessing &&
    member.canAddInternalNote
  ) {
    return "full";
  }
  if (
    member.canRead &&
    !member.canReply &&
    !member.canSend &&
    !member.canAssign &&
    !member.canManageProcessing &&
    !member.canAddInternalNote
  ) {
    return "read_only";
  }
  if (member.canRead && (member.canReply || member.canSend)) {
    return "reply";
  }
  return "custom";
}
