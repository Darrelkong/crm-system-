import type { MailMessage } from "../../../drizzle/schema/mail-messages";
import type { MailOutboundMessageMaterialization } from "../../../drizzle/schema/mail-outbound-message-materializations";

export type SafeMaterializationView = {
  id: string;
  sendOperationId: string;
  outboundRevisionId: string;
  acceptedTransportAttemptId: string;
  outboundRfcIdentityId: string;
  rfcMessageId: string;
  mailMessageId: string;
  messageDirection: "outbound";
  materializedAt: string;
  recipientCount: number;
  attachmentCount: number;
  message: {
    id: string;
    threadId: string;
    mailboxId: string;
    direction: "outbound";
    internetMessageId: string | null;
    subject: string;
    sentAt: string | null;
    composeMode: string | null;
  };
};

export function toSafeMaterializationView(
  materialization: MailOutboundMessageMaterialization,
  message: MailMessage,
  counts: { recipientCount: number; attachmentCount: number },
): SafeMaterializationView {
  return {
    id: materialization.id,
    sendOperationId: materialization.sendOperationId,
    outboundRevisionId: materialization.outboundRevisionId,
    acceptedTransportAttemptId: materialization.acceptedTransportAttemptId,
    outboundRfcIdentityId: materialization.outboundRfcIdentityId,
    rfcMessageId: materialization.rfcMessageId,
    mailMessageId: materialization.mailMessageId,
    messageDirection: "outbound",
    materializedAt: materialization.materializedAt,
    recipientCount: counts.recipientCount,
    attachmentCount: counts.attachmentCount,
    message: {
      id: message.id,
      threadId: message.threadId,
      mailboxId: message.mailboxId,
      direction: "outbound",
      internetMessageId: message.internetMessageId,
      subject: message.subject,
      sentAt: message.sentAt,
      composeMode: message.composeMode,
    },
  };
}
