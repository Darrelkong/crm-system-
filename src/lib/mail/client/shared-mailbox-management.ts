import type { MailAdminCenterCapabilities } from "@/lib/mail/mail-session-context";
import type { MailAccessAdminUser } from "@/lib/mail/client/mail-access-management";
import type { MailboxApiItem } from "@/lib/mail/client/mailbox-management";
import {
  isSystemSendingDomainAddress,
} from "@/lib/mail/client/mailbox-management";
import type { MailboxMemberRoleLabel } from "@/lib/mail/mailbox-member-serialization";
import { deriveMailboxMemberRoleLabel } from "@/lib/mail/mailbox-member-serialization";

export type MailboxMemberApiItem = {
  id: string;
  mailboxId: string;
  userId: string;
  canRead: boolean;
  canReply: boolean;
  canSend: boolean;
  canAssign: boolean;
  canManageProcessing: boolean;
  canAddInternalNote: boolean;
  grantedBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MailboxMemberPermissionDraft = {
  canRead: boolean;
  canReply: boolean;
  canSend: boolean;
  canAssign: boolean;
  canManageProcessing: boolean;
  canAddInternalNote: boolean;
};

export type SharedMailboxRow = {
  id: string;
  address: string;
  displayName: string | null;
  status: MailboxApiItem["status"];
  createdAt: string;
  memberCount: number;
};

export type SharedMailboxMemberRow = MailboxMemberApiItem & {
  userLabel: string;
  roleLabel: MailboxMemberRoleLabel;
};

export type SharedMailboxMemberRowActions = {
  showRemove: boolean;
  showEdit: boolean;
};

export function canManageSharedMailboxes(
  capabilities: Pick<MailAdminCenterCapabilities, "mailboxManagement">,
): boolean {
  return capabilities.mailboxManagement;
}

export function filterManageableSharedMailboxes(
  items: MailboxApiItem[],
): MailboxApiItem[] {
  return items.filter(
    (item) =>
      item.mailboxType === "shared" &&
      item.status !== "deleted" &&
      !isSystemSendingDomainAddress(item.address),
  );
}

export function resolveSharedMailboxUserLabel(
  userId: string,
  usersById: Map<string, MailAccessAdminUser>,
): string {
  const user = usersById.get(userId);
  if (!user) {
    return userId;
  }
  return user.name || user.email;
}

export function buildSharedMailboxRows(
  items: MailboxApiItem[],
  memberCountsByMailboxId: Map<string, number>,
): SharedMailboxRow[] {
  return filterManageableSharedMailboxes(items)
    .map((item) => ({
      id: item.id,
      address: item.address,
      displayName: item.displayName,
      status: item.status,
      createdAt: item.createdAt,
      memberCount: memberCountsByMailboxId.get(item.id) ?? 0,
    }))
    .sort((left, right) => left.address.localeCompare(right.address));
}

export function buildSharedMailboxMemberRows(
  members: MailboxMemberApiItem[],
  users: MailAccessAdminUser[],
): SharedMailboxMemberRow[] {
  const usersById = new Map(users.map((user) => [user.id, user] as const));
  return members
    .map((member) => ({
      ...member,
      userLabel: resolveSharedMailboxUserLabel(member.userId, usersById),
      roleLabel: deriveMailboxMemberRoleLabel(member),
    }))
    .sort((left, right) => left.userLabel.localeCompare(right.userLabel));
}

export function resolveSharedMailboxMemberRowActions(
  canManage: boolean,
): SharedMailboxMemberRowActions {
  if (!canManage) {
    return { showRemove: false, showEdit: false };
  }
  return { showRemove: true, showEdit: true };
}

export function memberPermissionsFromRole(
  role: Exclude<MailboxMemberRoleLabel, "custom">,
): MailboxMemberPermissionDraft {
  if (role === "full") {
    return {
      canRead: true,
      canReply: true,
      canSend: true,
      canAssign: true,
      canManageProcessing: true,
      canAddInternalNote: true,
    };
  }
  if (role === "reply") {
    return {
      canRead: true,
      canReply: true,
      canSend: true,
      canAssign: false,
      canManageProcessing: false,
      canAddInternalNote: true,
    };
  }
  return {
    canRead: true,
    canReply: false,
    canSend: false,
    canAssign: false,
    canManageProcessing: false,
    canAddInternalNote: false,
  };
}

export function hasAnyMemberPermission(draft: MailboxMemberPermissionDraft): boolean {
  return Object.values(draft).some(Boolean);
}

export function mailboxMembersPath(mailboxId: string): string {
  return `/api/mail/mailboxes/${encodeURIComponent(mailboxId)}/members`;
}

export function mailboxMemberPath(memberId: string): string {
  return `/api/mail/mailbox-members/${encodeURIComponent(memberId)}`;
}

export function mailboxMemberRevokePath(memberId: string): string {
  return `/api/mail/mailbox-members/${encodeURIComponent(memberId)}/revoke`;
}
