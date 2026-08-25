import { eq } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import type { DeliveryLifecycleHint } from "@/lib/mail/delivery-event-normalization";
import { MailServiceError } from "@/lib/mail/errors";
import {
  projectSendDeliveryLifecycle,
  type DeliveryEventSummary,
  type SendDeliveryLifecycleProjection,
} from "@/lib/mail/send-operation-delivery-projection";
import { getSendOperation } from "@/lib/mail/send-operation-service";
import { assertEffectiveMailAccess } from "@/lib/permissions/mail";

export type SafeDeliveryEventView = {
  id: string;
  sendOperationId: string;
  transportAttemptId: string;
  outboundRevisionRecipientId: string;
  eventType: "deferred" | "delivered" | "bounced";
  eventDedupeKey: string;
  providerEventId: string | null;
  providerOccurredAt: string | null;
  receivedAt: string;
  smtpStatusCode: string | null;
  smtpEnhancedStatusCode: string | null;
  diagnosticMessage: string | null;
  lifecycleHint: DeliveryLifecycleHint | null;
};

export type SafeSendDeliveryLifecycleView = SendDeliveryLifecycleProjection;

function inferLifecycleHint(
  diagnosticMessage: string | null,
): DeliveryLifecycleHint | null {
  if (!diagnosticMessage) {
    return null;
  }
  const normalized = diagnosticMessage.toLowerCase();
  if (normalized.includes("complaint") || normalized.includes("spam report")) {
    return "complaint";
  }
  if (normalized.includes("provider_failed") || normalized.includes("failed")) {
    return "provider_failed";
  }
  return null;
}

async function loadDeliveryEventsForSend(
  db: Database,
  sendOperationId: string,
  outboundRevisionId: string,
): Promise<DeliveryEventSummary[]> {
  const events = await db
    .select()
    .from(schema.mailDeliveryEvents)
    .where(eq(schema.mailDeliveryEvents.sendOperationId, sendOperationId))
    .orderBy(schema.mailDeliveryEvents.receivedAt);

  if (events.length === 0) {
    return [];
  }

  const recipients = await db
    .select()
    .from(schema.mailOutboundRevisionRecipients)
    .where(eq(schema.mailOutboundRevisionRecipients.revisionId, outboundRevisionId))
    .orderBy(schema.mailOutboundRevisionRecipients.sortOrder);

  const recipientById = new Map(recipients.map((row) => [row.id, row]));

  return events.map((event) => {
    const recipient = recipientById.get(event.outboundRevisionRecipientId);
    return {
      id: event.id,
      recipientId: event.outboundRevisionRecipientId,
      recipientAddress: recipient?.address ?? "",
      recipientType: recipient?.recipientType ?? "to",
      eventType: event.eventType,
      lifecycleHint: inferLifecycleHint(event.diagnosticMessage),
      receivedAt: event.receivedAt,
      providerEventId: event.providerEventId,
      diagnosticMessage: event.diagnosticMessage,
    };
  });
}

export async function getSendOperationDeliveryLifecycle(
  db: Database,
  actor: MailActorContext,
  sendOperationId: string,
): Promise<SafeSendDeliveryLifecycleView> {
  assertEffectiveMailAccess(actor);

  const sendView = await getSendOperation(db, actor, sendOperationId);
  const [send] = await db
    .select()
    .from(schema.mailSendOperations)
    .where(eq(schema.mailSendOperations.id, sendOperationId))
    .limit(1);
  if (!send) {
    throw MailServiceError.notFound("Send operation not found");
  }

  const recipients = await db
    .select()
    .from(schema.mailOutboundRevisionRecipients)
    .where(eq(schema.mailOutboundRevisionRecipients.revisionId, send.outboundRevisionId))
    .orderBy(schema.mailOutboundRevisionRecipients.sortOrder);

  const deliveryEvents = await loadDeliveryEventsForSend(
    db,
    sendOperationId,
    send.outboundRevisionId,
  );

  return projectSendDeliveryLifecycle({
    sendOperationId,
    sendStatus: send.status,
    hasRfcIdentity: Boolean(sendView.rfcIdentity),
    revisionRecipients: recipients.map((recipient) => ({
      id: recipient.id,
      address: recipient.address,
      recipientType: recipient.recipientType,
    })),
    deliveryEvents,
  });
}

export function toSafeDeliveryEventViews(
  events: DeliveryEventSummary[],
): SafeDeliveryEventView[] {
  return events.map((event) => ({
    id: event.id,
    sendOperationId: "",
    transportAttemptId: "",
    outboundRevisionRecipientId: event.recipientId,
    eventType: event.eventType,
    eventDedupeKey: "",
    providerEventId: event.providerEventId,
    providerOccurredAt: null,
    receivedAt: event.receivedAt,
    smtpStatusCode: null,
    smtpEnhancedStatusCode: null,
    diagnosticMessage: event.diagnosticMessage,
    lifecycleHint: event.lifecycleHint,
  }));
}
