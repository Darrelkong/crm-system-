import type { MailAdminCenterCapabilities } from "@/lib/mail/mail-session-context";
import type { MailAccessAdminUser } from "@/lib/mail/client/mail-access-management";
import type { MailboxApiItem } from "@/lib/mail/client/mailbox-management";
import { resolveMailboxOwnerLabel } from "@/lib/mail/client/mailbox-management";
import type { MailboxMemberApiItem } from "@/lib/mail/client/shared-mailbox-management";
import type { SenderIdentityApiItem } from "@/lib/mail/client/sender-identity-management";

export type SenderIdentityGrantApiItem = {
  id: string;
  senderIdentityId: string;
  userId: string;
  canReply: boolean;
  canSend: boolean;
  grantedBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SenderIdentityGrantUserOption = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "staff";
  status: MailAccessAdminUser["status"];
};

export type SenderIdentityGrantRow = {
  grantId: string;
  userId: string;
  name: string;
  email: string;
  role: "admin" | "staff";
  canSend: boolean;
  canReply: boolean;
  mailboxSendAuthorized: boolean;
};

export type SenderIdentityComposeMailboxView = {
  mailboxId: string;
  address: string;
  displayName: string | null;
  mailboxType: MailboxApiItem["mailboxType"];
  ownerLabel: string;
};

export type SenderIdentityGrantEligibility = {
  mailboxSendAuthorized: boolean;
  canGrantCanReply: boolean;
  canGrantCanSend: boolean;
};

export type CreateFormMailboxView = {
  mailboxId: string;
  address: string;
  displayName: string | null;
  mailboxType: MailboxApiItem["mailboxType"];
  ownerLabel: string | null;
  actorCanSend: boolean;
};

export const SENDER_IDENTITY_GRANT_I18N_KEYS = [
  "mail.adminCenter.senderIdentity.grants.manageAction",
  "mail.adminCenter.senderIdentity.grants.title",
  "mail.adminCenter.senderIdentity.grants.authorizedUsersTitle",
  "mail.adminCenter.senderIdentity.grants.authorizedUserCount",
  "mail.adminCenter.senderIdentity.grants.empty",
  "mail.adminCenter.senderIdentity.grants.addTitle",
  "mail.adminCenter.senderIdentity.grants.addAction",
  "mail.adminCenter.senderIdentity.grants.grantSuccess",
  "mail.adminCenter.senderIdentity.grants.revokeSuccess",
  "mail.adminCenter.senderIdentity.grants.revokeAction",
  "mail.adminCenter.senderIdentity.grants.userSearchLabel",
  "mail.adminCenter.senderIdentity.grants.userSearchPlaceholder",
  "mail.adminCenter.senderIdentity.grants.userSelectLabel",
  "mail.adminCenter.senderIdentity.grants.userSelectPlaceholder",
  "mail.adminCenter.senderIdentity.grants.canSendLabel",
  "mail.adminCenter.senderIdentity.grants.canReplyLabel",
  "mail.adminCenter.senderIdentity.grants.sendStatusAuthorized",
  "mail.adminCenter.senderIdentity.grants.sendStatusUnauthorized",
  "mail.adminCenter.senderIdentity.grants.replyStatusAuthorized",
  "mail.adminCenter.senderIdentity.grants.replyStatusUnauthorized",
  "mail.adminCenter.senderIdentity.grants.mailboxSendCapable",
  "mail.adminCenter.senderIdentity.grants.mailboxSendNotCapable",
  "mail.adminCenter.senderIdentity.grants.staffRole",
  "mail.adminCenter.senderIdentity.grants.composeMailboxTitle",
  "mail.adminCenter.senderIdentity.grants.personalMailboxOwner",
  "mail.adminCenter.senderIdentity.grants.sharedMailboxHint",
  "mail.adminCenter.senderIdentity.grants.missingComposeMailbox",
  "mail.adminCenter.senderIdentity.grants.missingMailboxSendAuthorization",
  "mail.adminCenter.senderIdentity.grants.missingMailboxReplyAuthorization",
  "mail.adminCenter.senderIdentity.grants.userMissingMailboxSendAuthorization",
  "mail.adminCenter.senderIdentity.grants.permissionRequired",
  "mail.adminCenter.senderIdentity.grants.mailboxOptionActorCanSend",
  "mail.adminCenter.senderIdentity.grants.mailboxOptionActorCannotSend",
  "mail.adminCenter.senderIdentity.grants.mailboxOptionNotSendCapable",
  "mail.adminCenter.senderIdentity.grants.noEligibleSendMailbox",
  "mail.adminCenter.senderIdentity.grants.goToMailboxAccess",
  "mail.adminCenter.senderIdentity.grants.createPersonalMailboxHint",
  "mail.adminCenter.senderIdentity.mailboxHelper",
  "mail.adminCenter.senderIdentity.grantSelfOnCreateLabel",
  "mail.adminCenter.senderIdentity.grantSelfOnCreateBlocked",
  "mail.adminCenter.senderIdentity.grantSelfOnCreateSetupHint",
] as const;

export function canManageSenderIdentityGrants(
  capabilities: Pick<MailAdminCenterCapabilities, "senderIdentityManagement">,
): boolean {
  return capabilities.senderIdentityManagement;
}

export function senderIdentityGrantsPath(identityId: string): string {
  return `/api/mail/sender-identities/${encodeURIComponent(identityId)}/grants`;
}

export function senderIdentityGrantRevokePath(grantId: string): string {
  return `/api/mail/sender-identity-grants/${encodeURIComponent(grantId)}/revoke`;
}

export function resolveComposeMailboxId(
  identity: Pick<SenderIdentityApiItem, "defaultMailboxId" | "sentFolderMailboxId">,
): string | null {
  if (identity.defaultMailboxId) {
    return identity.defaultMailboxId;
  }
  return identity.sentFolderMailboxId ?? null;
}

export function userHasMailboxSendAuthorization(
  userId: string,
  mailbox: Pick<
    MailboxApiItem,
    "id" | "mailboxType" | "createdBy" | "status"
  > | null,
  members: Pick<MailboxMemberApiItem, "userId" | "canSend" | "revokedAt">[],
): boolean {
  if (!mailbox || mailbox.status !== "active") {
    return false;
  }
  if (
    mailbox.mailboxType === "personal" &&
    mailbox.createdBy != null &&
    mailbox.createdBy === userId
  ) {
    return true;
  }
  return members.some(
    (member) =>
      member.userId === userId &&
      member.canSend &&
      member.revokedAt == null,
  );
}

export function userHasMailboxReplyAuthorization(
  userId: string,
  mailbox: Pick<
    MailboxApiItem,
    "id" | "mailboxType" | "createdBy" | "status"
  > | null,
  members: Pick<MailboxMemberApiItem, "userId" | "canReply" | "revokedAt">[],
): boolean {
  if (!mailbox || mailbox.status !== "active") {
    return false;
  }
  if (
    mailbox.mailboxType === "personal" &&
    mailbox.createdBy != null &&
    mailbox.createdBy === userId
  ) {
    return true;
  }
  return members.some(
    (member) =>
      member.userId === userId &&
      member.canReply &&
      member.revokedAt == null,
  );
}

export function resolveComposeMailboxView(
  identity: SenderIdentityApiItem,
  mailboxes: MailboxApiItem[],
  users: SenderIdentityGrantUserOption[],
): SenderIdentityComposeMailboxView | null {
  const mailboxId = resolveComposeMailboxId(identity);
  if (!mailboxId) {
    return null;
  }
  const mailbox = mailboxes.find((item) => item.id === mailboxId) ?? null;
  if (!mailbox) {
    return null;
  }
  const usersById = new Map(
    users.map(
      (user) =>
        [
          user.id,
          {
            id: user.id,
            name: user.name,
            email: user.email,
            status: user.status,
          },
        ] as const,
    ),
  );
  return {
    mailboxId: mailbox.id,
    address: mailbox.address,
    displayName: mailbox.displayName,
    mailboxType: mailbox.mailboxType,
    ownerLabel: resolveMailboxOwnerLabel(mailbox.createdBy, usersById),
  };
}

export function countActiveSenderIdentityGrants(
  grants: SenderIdentityGrantApiItem[],
): number {
  return grants.filter((grant) => grant.revokedAt == null).length;
}

export function mapGrantUserOptions(
  users: Array<
    MailAccessAdminUser & {
      role?: "admin" | "staff";
    }
  >,
): SenderIdentityGrantUserOption[] {
  return users
    .filter((user) => user.status === "active")
    .map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: (user.role === "admin" ? "admin" : "staff") as "admin" | "staff",
      status: user.status,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function buildSenderIdentityGrantRows(
  grants: SenderIdentityGrantApiItem[],
  users: SenderIdentityGrantUserOption[],
  mailbox: Pick<
    MailboxApiItem,
    "id" | "mailboxType" | "createdBy" | "status"
  > | null,
  members: MailboxMemberApiItem[],
): SenderIdentityGrantRow[] {
  const usersById = new Map(users.map((user) => [user.id, user] as const));
  return grants
    .filter((grant) => grant.revokedAt == null)
    .map((grant) => {
      const user = usersById.get(grant.userId);
      return {
        grantId: grant.id,
        userId: grant.userId,
        name: user?.name ?? grant.userId,
        email: user?.email ?? "—",
        role: user?.role ?? "staff",
        canSend: grant.canSend,
        canReply: grant.canReply,
        mailboxSendAuthorized: userHasMailboxSendAuthorization(
          grant.userId,
          mailbox,
          members,
        ),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function resolveSenderIdentityGrantEligibility(
  userId: string,
  mailbox: Pick<
    MailboxApiItem,
    "id" | "mailboxType" | "createdBy" | "status"
  > | null,
  members: MailboxMemberApiItem[],
): SenderIdentityGrantEligibility {
  const mailboxSendAuthorized = userHasMailboxSendAuthorization(
    userId,
    mailbox,
    members,
  );
  const mailboxReplyAuthorized = userHasMailboxReplyAuthorization(
    userId,
    mailbox,
    members,
  );
  return {
    mailboxSendAuthorized,
    canGrantCanSend: mailboxSendAuthorized,
    canGrantCanReply: mailboxReplyAuthorized,
  };
}

export function filterGrantPickerUsers(
  users: SenderIdentityGrantUserOption[],
  grants: SenderIdentityGrantApiItem[],
  query: string,
): SenderIdentityGrantUserOption[] {
  const grantedUserIds = new Set(
    grants
      .filter((grant) => grant.revokedAt == null)
      .map((grant) => grant.userId),
  );
  const normalizedQuery = query.trim().toLowerCase();
  return users
    .filter((user) => !grantedUserIds.has(user.id))
    .filter((user) => {
      if (!normalizedQuery) {
        return true;
      }
      return (
        user.name.toLowerCase().includes(normalizedQuery) ||
        user.email.toLowerCase().includes(normalizedQuery)
      );
    });
}

export function isSelfGrantSubmitEnabled(input: {
  grantSelfOnCreate: boolean;
  defaultMailboxId: string;
  selfUserId: string | null;
  mailbox: Pick<
    MailboxApiItem,
    "id" | "mailboxType" | "createdBy" | "status"
  > | null;
  members: MailboxMemberApiItem[];
}): boolean {
  if (!input.grantSelfOnCreate) {
    return true;
  }
  if (!input.selfUserId || !input.defaultMailboxId.trim()) {
    return false;
  }
  return userHasMailboxSendAuthorization(
    input.selfUserId,
    input.mailbox,
    input.members,
  );
}

export function resolveCreateIdentitySelfGrantBlockedReason(input: {
  grantSelfOnCreate: boolean;
  selfUserId: string | null;
  mailbox: Pick<
    MailboxApiItem,
    "id" | "mailboxType" | "createdBy" | "status"
  > | null;
  members: MailboxMemberApiItem[];
}): "missingMailboxSendAuthorization" | null {
  if (!input.grantSelfOnCreate || !input.selfUserId) {
    return null;
  }
  if (
    userHasMailboxSendAuthorization(
      input.selfUserId,
      input.mailbox,
      input.members,
    )
  ) {
    return null;
  }
  return "missingMailboxSendAuthorization";
}

export function resolveCreateFormMailboxView(
  mailbox: MailboxApiItem,
  users: SenderIdentityGrantUserOption[],
  actorUserId: string | null,
  members: MailboxMemberApiItem[],
): CreateFormMailboxView {
  const usersById = new Map(users.map((user) => [user.id, user] as const));
  const ownerLabel =
    mailbox.mailboxType === "personal"
      ? resolveMailboxOwnerLabel(mailbox.createdBy, usersById)
      : null;
  return {
    mailboxId: mailbox.id,
    address: mailbox.address,
    displayName: mailbox.displayName,
    mailboxType: mailbox.mailboxType,
    ownerLabel,
    actorCanSend: actorUserId
      ? userHasMailboxSendAuthorization(actorUserId, mailbox, members)
      : false,
  };
}

export function actorHasEligibleSendMailbox(
  mailboxes: MailboxApiItem[],
  actorUserId: string,
  membersByMailboxId: Readonly<
    Record<string, Pick<MailboxMemberApiItem, "userId" | "canSend" | "revokedAt">[]>
  >,
): boolean {
  return mailboxes.some((mailbox) => {
    if (mailbox.status !== "active") {
      return false;
    }
    return userHasMailboxSendAuthorization(
      actorUserId,
      mailbox,
      membersByMailboxId[mailbox.id] ?? [],
    );
  });
}

export function listActorEligibleSendMailboxes(
  mailboxes: MailboxApiItem[],
  actorUserId: string,
  membersByMailboxId: Readonly<
    Record<string, Pick<MailboxMemberApiItem, "userId" | "canSend" | "revokedAt">[]>
  >,
): MailboxApiItem[] {
  return mailboxes.filter(
    (mailbox) =>
      mailbox.status === "active" &&
      userHasMailboxSendAuthorization(
        actorUserId,
        mailbox,
        membersByMailboxId[mailbox.id] ?? [],
      ),
  );
}
