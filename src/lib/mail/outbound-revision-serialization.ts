import type { MailOutboundRevision } from "../../../drizzle/schema/mail-outbound-revisions";
import type { MailOutboundRevisionRecipient } from "../../../drizzle/schema/mail-outbound-revision-recipients";

export type SafeOutboundRevisionRecipientView = {
  recipientType: MailOutboundRevisionRecipient["recipientType"];
  address: string;
  displayName: string | null;
  sortOrder: number;
};

export type SafeOutboundRevisionView = {
  id: string;
  revisionChainId: string;
  revisionNumber: number;
  parentRevisionId: string | null;
  sourceDraftId: string | null;
  revisionKind: MailOutboundRevision["revisionKind"];
  mailboxId: string;
  senderIdentityId: string;
  fromAddress: string;
  fromDisplayName: string | null;
  subject: string;
  bodyText: string;
  bodyHtmlSanitized: string | null;
  sensitivity: MailOutboundRevision["sensitivity"];
  composeMode: MailOutboundRevision["composeMode"];
  signatureSnapshotId: string;
  contentHash: string;
  hashVersion: number;
  createdAt: string;
  createdByUserId: string;
};

export type SafeOutboundRevisionDetailView = SafeOutboundRevisionView & {
  recipients: SafeOutboundRevisionRecipientView[];
};

export function toSafeOutboundRevisionRecipientView(
  recipient: MailOutboundRevisionRecipient,
): SafeOutboundRevisionRecipientView {
  return {
    recipientType: recipient.recipientType,
    address: recipient.address,
    displayName: recipient.displayName,
    sortOrder: recipient.sortOrder,
  };
}

export function toSafeOutboundRevisionView(
  revision: MailOutboundRevision,
): SafeOutboundRevisionView {
  return {
    id: revision.id,
    revisionChainId: revision.revisionChainId,
    revisionNumber: revision.revisionNumber,
    parentRevisionId: revision.parentRevisionId,
    sourceDraftId: revision.sourceDraftId,
    revisionKind: revision.revisionKind,
    mailboxId: revision.mailboxId,
    senderIdentityId: revision.senderIdentityId,
    fromAddress: revision.fromAddress,
    fromDisplayName: revision.fromDisplayName,
    subject: revision.subject,
    bodyText: revision.bodyText,
    bodyHtmlSanitized: revision.bodyHtmlSanitized,
    sensitivity: revision.sensitivity,
    composeMode: revision.composeMode,
    signatureSnapshotId: revision.signatureSnapshotId,
    contentHash: revision.contentHash,
    hashVersion: revision.hashVersion,
    createdAt: revision.createdAt,
    createdByUserId: revision.createdByUserId,
  };
}

export function toSafeOutboundRevisionDetailView(
  revision: MailOutboundRevision,
  recipients: SafeOutboundRevisionRecipientView[],
): SafeOutboundRevisionDetailView {
  return {
    ...toSafeOutboundRevisionView(revision),
    recipients,
  };
}
