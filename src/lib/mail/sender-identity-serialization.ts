import type { MailSenderIdentity } from "../../../drizzle/schema/mail-sender-identities";
import type { MailSenderIdentityGrant } from "../../../drizzle/schema/mail-sender-identity-grants";

export type SafeSenderIdentityAdminView = {
  id: string;
  address: string;
  displayName: string | null;
  status: MailSenderIdentity["status"];
  defaultMailboxId: string | null;
  sentFolderMailboxId: string | null;
  aliasOfIdentityId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SafeSenderIdentityGrantView = {
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

export function toSafeSenderIdentityAdminView(
  identity: MailSenderIdentity,
): SafeSenderIdentityAdminView {
  return {
    id: identity.id,
    address: identity.address,
    displayName: identity.displayName,
    status: identity.status,
    defaultMailboxId: identity.defaultMailboxId,
    sentFolderMailboxId: identity.sentFolderMailboxId,
    aliasOfIdentityId: identity.aliasOfIdentityId,
    createdBy: identity.createdBy,
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
  };
}

export function toSafeSenderIdentityGrantView(
  grant: MailSenderIdentityGrant,
): SafeSenderIdentityGrantView {
  return {
    id: grant.id,
    senderIdentityId: grant.senderIdentityId,
    userId: grant.userId,
    canReply: grant.canReply === 1,
    canSend: grant.canSend === 1,
    grantedBy: grant.grantedBy,
    revokedAt: grant.revokedAt,
    revokedBy: grant.revokedBy,
    createdAt: grant.createdAt,
    updatedAt: grant.updatedAt,
  };
}
