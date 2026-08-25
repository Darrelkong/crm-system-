export const dynamic = "force-dynamic";

import { getDb } from "@/lib/db";
import { getAttachmentsBucket } from "@/lib/mail/attachments-env";
import { receiveDeliveryProviderWebhook } from "@/lib/mail/delivery-webhook-receiver";
import { getDeliveryWebhookSecret } from "@/lib/mail/delivery-webhook-env";
import {
  MAIL_DELIVERY_WEBHOOK_SIGNATURE_HEADER,
  MAIL_DELIVERY_WEBHOOK_TIMESTAMP_HEADER,
} from "@/lib/mail/delivery-webhook-signature";
import { mailErrorResponse } from "@/lib/mail/errors";
import type { RawProviderDeliveryWebhookPayload } from "@/lib/mail/delivery-event-normalization";
import { createInboundRawPayloadStore } from "@/lib/mail/inbound-raw-payload-store";

type RouteContext = { params: Promise<{ provider: string }> };

/**
 * Provider delivery webhook ingress — HMAC signature + timestamp verification.
 * Does NOT invoke Cloudflare Email Sending or EMAIL binding.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { provider } = await context.params;
    const rawBody = await request.text();
    const payload = JSON.parse(rawBody) as RawProviderDeliveryWebhookPayload;

    const db = getDb();
    const payloadStore = createInboundRawPayloadStore(getAttachmentsBucket());

    const result = await receiveDeliveryProviderWebhook(db, payloadStore, {
      provider,
      payload,
      rawBody,
      signatureHeader: request.headers.get(MAIL_DELIVERY_WEBHOOK_SIGNATURE_HEADER),
      timestampHeader: request.headers.get(MAIL_DELIVERY_WEBHOOK_TIMESTAMP_HEADER),
      receivedAt: new Date().toISOString(),
      security: {
        webhookSecret: getDeliveryWebhookSecret(provider),
      },
    });

    return Response.json({
      ok: true,
      verified: true,
      idempotentReplay: result.staged.idempotentReplay,
      ingestionEventId: result.staged.ingestionEventId,
      providerLookup: result.providerLookup,
      normalizedEventType: result.normalized.deliveryEventType,
      lifecycleHint: result.normalized.lifecycleHint,
    });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
