import { and, eq, sql } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import { MailServiceError } from "@/lib/mail/errors";
import { normalizeMailEmailAddress } from "@/lib/mail/normalize-email-address";

export type ResolvedDeliveryCorrelation = {
  sendOperationId: string;
  transportAttemptId: string;
  outboundRevisionId: string;
  outboundRevisionRecipientId: string;
  normalizedRecipientAddress: string;
  correlatedAt: string;
};

export type DeliveryCorrelationFailureReason =
  | "missing_provider_message_id"
  | "no_accepted_transport_attempt"
  | "ambiguous_transport_attempt"
  | "send_not_accepted"
  | "transport_not_accepted"
  | "recipient_not_on_revision";

export type DeliveryCorrelationResult =
  | { status: "resolved"; correlation: ResolvedDeliveryCorrelation }
  | { status: "unresolved"; reason: DeliveryCorrelationFailureReason }
  | { status: "integrity_conflict"; reason: DeliveryCorrelationFailureReason };

/**
 * Exact outbound recipient correlation via accepted transport attempt
 * provider_message_id — never guesses by address/time alone.
 */
export async function correlateDeliveryRecipient(
  db: Database,
  input: {
    provider: string;
    providerMessageId: string | null | undefined;
    recipientAddress: string;
    now?: string;
  },
): Promise<DeliveryCorrelationResult> {
  const providerMessageId = input.providerMessageId?.trim();
  if (!providerMessageId) {
    return { status: "unresolved", reason: "missing_provider_message_id" };
  }

  const normalizedRecipientAddress = normalizeMailEmailAddress(
    input.recipientAddress,
  );
  const provider = input.provider.trim();

  const attempts = await db
    .select()
    .from(schema.mailTransportAttempts)
    .where(
      and(
        eq(schema.mailTransportAttempts.providerMessageId, providerMessageId),
        eq(schema.mailTransportAttempts.provider, provider),
        eq(schema.mailTransportAttempts.state, "accepted"),
      ),
    );

  if (attempts.length === 0) {
    return { status: "unresolved", reason: "no_accepted_transport_attempt" };
  }

  if (attempts.length > 1) {
    return {
      status: "integrity_conflict",
      reason: "ambiguous_transport_attempt",
    };
  }

  const attempt = attempts[0]!;

  const [send] = await db
    .select()
    .from(schema.mailSendOperations)
    .where(eq(schema.mailSendOperations.id, attempt.sendOperationId))
    .limit(1);

  if (!send) {
    return { status: "integrity_conflict", reason: "send_not_accepted" };
  }

  if (send.status !== "accepted") {
    return { status: "unresolved", reason: "send_not_accepted" };
  }

  if (attempt.state !== "accepted") {
    return { status: "integrity_conflict", reason: "transport_not_accepted" };
  }

  const recipients = await db
    .select()
    .from(schema.mailOutboundRevisionRecipients)
    .where(
      and(
        eq(
          schema.mailOutboundRevisionRecipients.revisionId,
          send.outboundRevisionId,
        ),
        eq(
          sql`lower(${schema.mailOutboundRevisionRecipients.address})`,
          normalizedRecipientAddress,
        ),
      ),
    )
    .limit(2);

  if (recipients.length === 0) {
    return {
      status: "integrity_conflict",
      reason: "recipient_not_on_revision",
    };
  }

  if (recipients.length > 1) {
    return {
      status: "integrity_conflict",
      reason: "recipient_not_on_revision",
    };
  }

  return {
    status: "resolved",
    correlation: {
      sendOperationId: send.id,
      transportAttemptId: attempt.id,
      outboundRevisionId: send.outboundRevisionId,
      outboundRevisionRecipientId: recipients[0]!.id,
      normalizedRecipientAddress,
      correlatedAt: input.now ?? new Date().toISOString(),
    },
  };
}

export function correlationFailureToQuarantineReason(
  reason: DeliveryCorrelationFailureReason,
): string {
  switch (reason) {
    case "missing_provider_message_id":
      return "missing_provider_message_id";
    case "no_accepted_transport_attempt":
      return "correlation_unresolved";
    case "ambiguous_transport_attempt":
      return "ambiguous_transport_attempt";
    case "send_not_accepted":
      return "send_not_accepted";
    case "transport_not_accepted":
      return "transport_not_accepted";
    case "recipient_not_on_revision":
      return "recipient_not_on_revision";
    default:
      return "integrity_conflict";
  }
}

export function isDeterministicCorrelationFailure(
  result: DeliveryCorrelationResult,
): boolean {
  if (result.status === "resolved") {
    return false;
  }
  if (result.status === "unresolved") {
    return result.reason === "missing_provider_message_id";
  }
  return true;
}

export function assertResolvedDeliveryCorrelation(
  result: DeliveryCorrelationResult,
): ResolvedDeliveryCorrelation {
  if (result.status !== "resolved") {
    throw MailServiceError.integrityConflict(
      "Delivery recipient correlation unresolved",
      { result },
    );
  }
  return result.correlation;
}
