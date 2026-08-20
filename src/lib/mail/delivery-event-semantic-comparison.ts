import type { MailDeliveryEventType } from "../../../drizzle/schema/mail-delivery-events";
import { MailServiceError } from "@/lib/mail/errors";

export type DeliveryEventSemanticGraph = {
  sendOperationId: string;
  transportAttemptId: string;
  outboundRevisionId: string;
  outboundRevisionRecipientId: string;
  eventType: MailDeliveryEventType;
  eventDedupeKey: string;
  providerEventId: string | null;
  providerOccurredAt: string | null;
  smtpStatusCode: string | null;
  smtpEnhancedStatusCode: string | null;
  diagnosticMessage: string | null;
};

export function deliveryEventSemanticGraphsEqual(
  left: DeliveryEventSemanticGraph,
  right: DeliveryEventSemanticGraph,
): boolean {
  return (
    left.sendOperationId === right.sendOperationId &&
    left.transportAttemptId === right.transportAttemptId &&
    left.outboundRevisionId === right.outboundRevisionId &&
    left.outboundRevisionRecipientId === right.outboundRevisionRecipientId &&
    left.eventType === right.eventType &&
    left.eventDedupeKey === right.eventDedupeKey &&
    left.providerEventId === right.providerEventId &&
    left.providerOccurredAt === right.providerOccurredAt &&
    left.smtpStatusCode === right.smtpStatusCode &&
    left.smtpEnhancedStatusCode === right.smtpEnhancedStatusCode &&
    left.diagnosticMessage === right.diagnosticMessage
  );
}

export function assertDeliveryEventSemanticGraphsEqual(
  left: DeliveryEventSemanticGraph,
  right: DeliveryEventSemanticGraph,
): void {
  if (!deliveryEventSemanticGraphsEqual(left, right)) {
    throw MailServiceError.integrityConflict(
      "Delivery event dedupe collision with differing semantics",
      { left, right },
    );
  }
}
