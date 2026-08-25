import type { MailDeliveryEventType } from "../../../drizzle/schema/mail-delivery-events";
import type { MailSendOperation } from "../../../drizzle/schema/mail-send-operations";
import type { DeliveryLifecycleHint } from "@/lib/mail/delivery-event-normalization";

export type SendDeliveryLifecyclePhase =
  | "queued"
  | "processing"
  | "accepted"
  | "delivered"
  | "deferred"
  | "bounced"
  | "failed"
  | "complaint";

export type RecipientDeliveryOutcome =
  | "pending"
  | "deferred"
  | "delivered"
  | "bounced";

export type DeliveryEventSummary = {
  id: string;
  recipientId: string;
  recipientAddress: string;
  recipientType: string;
  eventType: MailDeliveryEventType;
  lifecycleHint: DeliveryLifecycleHint | null;
  receivedAt: string;
  providerEventId: string | null;
  diagnosticMessage: string | null;
};

export type SendDeliveryLifecycleProjection = {
  sendOperationId: string;
  sendStatus: MailSendOperation["status"];
  transportPhase: "queued" | "processing" | "accepted" | "failed";
  lifecyclePhase: SendDeliveryLifecyclePhase;
  recipients: Array<{
    recipientId: string;
    address: string;
    recipientType: string;
    outcome: RecipientDeliveryOutcome;
    latestEventType: MailDeliveryEventType | null;
    latestEventAt: string | null;
    lifecycleHint: DeliveryLifecycleHint | null;
  }>;
  deliveryEvents: DeliveryEventSummary[];
};

const TERMINAL_DELIVERY_TYPES = new Set<MailDeliveryEventType>([
  "delivered",
  "bounced",
]);

function resolveTransportPhase(
  sendStatus: MailSendOperation["status"],
  hasRfcIdentity: boolean,
): SendDeliveryLifecycleProjection["transportPhase"] {
  if (sendStatus === "pending") {
    return hasRfcIdentity ? "queued" : "queued";
  }
  if (sendStatus === "processing") {
    return "processing";
  }
  if (sendStatus === "accepted") {
    return "accepted";
  }
  return "failed";
}

function resolveRecipientOutcome(
  events: DeliveryEventSummary[],
  recipientId: string,
): {
  outcome: RecipientDeliveryOutcome;
  latestEventType: MailDeliveryEventType | null;
  latestEventAt: string | null;
  lifecycleHint: DeliveryLifecycleHint | null;
} {
  const recipientEvents = events
    .filter((event) => event.recipientId === recipientId)
    .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt));

  if (recipientEvents.length === 0) {
    return {
      outcome: "pending",
      latestEventType: null,
      latestEventAt: null,
      lifecycleHint: null,
    };
  }

  const latest = recipientEvents[0]!;
  const terminal = recipientEvents.find((event) =>
    TERMINAL_DELIVERY_TYPES.has(event.eventType),
  );

  if (terminal?.eventType === "delivered") {
    return {
      outcome: "delivered",
      latestEventType: terminal.eventType,
      latestEventAt: terminal.receivedAt,
      lifecycleHint: terminal.lifecycleHint,
    };
  }

  if (terminal?.eventType === "bounced") {
    return {
      outcome: "bounced",
      latestEventType: terminal.eventType,
      latestEventAt: terminal.receivedAt,
      lifecycleHint: terminal.lifecycleHint,
    };
  }

  return {
    outcome: "deferred",
    latestEventType: latest.eventType,
    latestEventAt: latest.receivedAt,
    lifecycleHint: latest.lifecycleHint,
  };
}

function resolveAggregateLifecyclePhase(input: {
  sendStatus: MailSendOperation["status"];
  recipients: SendDeliveryLifecycleProjection["recipients"];
}): SendDeliveryLifecyclePhase {
  if (input.sendStatus === "pending") {
    return "queued";
  }
  if (input.sendStatus === "processing") {
    return "processing";
  }
  if (input.sendStatus === "failed") {
    return "failed";
  }

  if (input.recipients.length === 0) {
    return "accepted";
  }

  const hasComplaint = input.recipients.some(
    (recipient) => recipient.lifecycleHint === "complaint",
  );
  if (hasComplaint) {
    return "complaint";
  }

  const allDelivered = input.recipients.every(
    (recipient) => recipient.outcome === "delivered",
  );
  if (allDelivered) {
    return "delivered";
  }

  const anyBounced = input.recipients.some(
    (recipient) => recipient.outcome === "bounced",
  );
  if (anyBounced) {
    return "bounced";
  }

  const anyDeferred = input.recipients.some(
    (recipient) => recipient.outcome === "deferred",
  );
  if (anyDeferred) {
    return "deferred";
  }

  return "accepted";
}

export function projectSendDeliveryLifecycle(input: {
  sendOperationId: string;
  sendStatus: MailSendOperation["status"];
  hasRfcIdentity: boolean;
  revisionRecipients: Array<{
    id: string;
    address: string;
    recipientType: string;
  }>;
  deliveryEvents: DeliveryEventSummary[];
}): SendDeliveryLifecycleProjection {
  const recipients = input.revisionRecipients.map((recipient) => {
    const resolved = resolveRecipientOutcome(
      input.deliveryEvents,
      recipient.id,
    );
    return {
      recipientId: recipient.id,
      address: recipient.address,
      recipientType: recipient.recipientType,
      outcome: resolved.outcome,
      latestEventType: resolved.latestEventType,
      latestEventAt: resolved.latestEventAt,
      lifecycleHint: resolved.lifecycleHint,
    };
  });

  const transportPhase = resolveTransportPhase(
    input.sendStatus,
    input.hasRfcIdentity,
  );

  return {
    sendOperationId: input.sendOperationId,
    sendStatus: input.sendStatus,
    transportPhase,
    lifecyclePhase: resolveAggregateLifecyclePhase({
      sendStatus: input.sendStatus,
      recipients,
    }),
    recipients,
    deliveryEvents: input.deliveryEvents,
  };
}
