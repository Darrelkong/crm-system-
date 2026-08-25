import type { Database } from "@/lib/db";
import {
  normalizeProviderDeliveryWebhookPayload,
  type NormalizedProviderDeliveryEvent,
  type RawProviderDeliveryWebhookPayload,
} from "@/lib/mail/delivery-event-normalization";
import {
  recordDeliveryWebhookAccepted,
  recordDeliveryWebhookRejected,
} from "@/lib/mail/delivery-webhook-audit-service";
import {
  stageDeliveryProviderEvent,
  type StageDeliveryProviderEventInput,
  type StagedDeliveryProviderEventResult,
} from "@/lib/mail/delivery-provider-staging-service";
import {
  validateDeliveryWebhookSecurity,
  type DeliveryWebhookSecurityConfig,
  type DeliveryWebhookSignatureValidationResult,
} from "@/lib/mail/delivery-webhook-signature";
import { MailServiceError } from "@/lib/mail/errors";
import type { InboundRawPayloadStore } from "@/lib/mail/inbound-raw-payload-store";
import { resolveSendOperationFromProviderIds } from "@/lib/mail/send-operation-provider-lookup";

export type ReceiveDeliveryWebhookInput = {
  provider: string;
  payload: RawProviderDeliveryWebhookPayload;
  rawBody: string;
  signatureHeader: string | null;
  timestampHeader?: string | null;
  receivedAt: string;
  security: DeliveryWebhookSecurityConfig;
};

export type ReceiveDeliveryWebhookResult = {
  signature: DeliveryWebhookSignatureValidationResult;
  normalized: NormalizedProviderDeliveryEvent;
  providerLookup: Awaited<
    ReturnType<typeof resolveSendOperationFromProviderIds>
  >;
  staged: StagedDeliveryProviderEventResult;
};

function toStageInput(
  normalized: NormalizedProviderDeliveryEvent,
  receivedAt: string,
  rawPayloadBytes?: Uint8Array,
): StageDeliveryProviderEventInput {
  return {
    provider: normalized.provider,
    providerEventId: normalized.providerEventId,
    providerRequestId: normalized.providerRequestId,
    providerMessageId: normalized.providerMessageId,
    recipientAddress: normalized.recipientAddress,
    deliveryEventType: normalized.deliveryEventType,
    providerOccurredAt: normalized.providerOccurredAt,
    smtpStatusCode: normalized.smtpStatusCode,
    smtpEnhancedStatusCode: normalized.smtpEnhancedStatusCode,
    diagnosticMessage: normalized.diagnosticMessage,
    receivedAt,
    rawPayloadBytes,
  };
}

function readProviderEventId(payload: RawProviderDeliveryWebhookPayload): string | null {
  const candidates = [payload.eventId, payload.requestId, payload.messageId];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function securityFailureStatus(
  rejectionReason: string,
): { errorCode: "FORBIDDEN" | "VALIDATION"; status: number } {
  if (
    rejectionReason === "invalid_signature" ||
    rejectionReason === "missing_secret"
  ) {
    return { errorCode: "FORBIDDEN", status: 403 };
  }
  return { errorCode: "VALIDATION", status: 400 };
}

export async function receiveDeliveryProviderWebhook(
  db: Database,
  payloadStore: InboundRawPayloadStore | null,
  input: ReceiveDeliveryWebhookInput,
): Promise<ReceiveDeliveryWebhookResult> {
  const providerEventIdHint = readProviderEventId(input.payload);

  const signature = validateDeliveryWebhookSecurity(
    {
      provider: input.provider,
      signatureHeader: input.signatureHeader,
      timestampHeader: input.timestampHeader,
      rawBody: input.rawBody,
    },
    input.security,
  );

  if (!signature.ok) {
    await recordDeliveryWebhookRejected(db, {
      provider: input.provider,
      providerEventId: providerEventIdHint,
      rejectionReason: signature.rejectionReason,
      reason: signature.reason,
      receivedAt: input.receivedAt,
    });
    const failure = securityFailureStatus(signature.rejectionReason);
    throw new MailServiceError(
      failure.errorCode,
      signature.reason,
      failure.status,
      { rejectionReason: signature.rejectionReason },
    );
  }

  let normalized: NormalizedProviderDeliveryEvent;
  try {
    normalized = normalizeProviderDeliveryWebhookPayload({
      provider: input.provider,
      payload: input.payload,
    });
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Invalid delivery webhook payload";
    await recordDeliveryWebhookRejected(db, {
      provider: input.provider,
      providerEventId: providerEventIdHint,
      rejectionReason: "invalid_payload",
      reason,
      receivedAt: input.receivedAt,
      timestampSeconds: signature.timestampSeconds,
    });
    throw MailServiceError.validation(reason);
  }

  const providerLookup = await resolveSendOperationFromProviderIds(db, {
    provider: normalized.provider,
    providerMessageId: normalized.providerMessageId,
    providerRequestId: normalized.providerRequestId,
  });

  const rawPayloadBytes = payloadStore
    ? new TextEncoder().encode(input.rawBody)
    : undefined;

  let staged: StagedDeliveryProviderEventResult;
  try {
    staged = await stageDeliveryProviderEvent(
      db,
      payloadStore,
      toStageInput(normalized, input.receivedAt, rawPayloadBytes),
    );
  } catch (error) {
    if (
      error instanceof MailServiceError &&
      error.errorCode === "INTEGRITY_CONFLICT"
    ) {
      await recordDeliveryWebhookRejected(db, {
        provider: input.provider,
        providerEventId: normalized.providerEventId,
        rejectionReason: "duplicate_event",
        reason: error.message,
        receivedAt: input.receivedAt,
        timestampSeconds: signature.timestampSeconds,
      });
    }
    throw error;
  }

  await recordDeliveryWebhookAccepted(db, {
    provider: normalized.provider,
    providerEventId: normalized.providerEventId,
    ingestionEventId: staged.ingestionEventId,
    idempotentReplay: staged.idempotentReplay,
    timestampSeconds: signature.timestampSeconds,
    receivedAt: input.receivedAt,
  });

  return {
    signature,
    normalized,
    providerLookup,
    staged,
  };
}
