import type { Database } from "@/lib/db";
import type { InboundRawPayloadBucket } from "@/lib/mail/inbound-raw-payload-store";
import { createCloudflareEmailOutboundTransport } from "@/lib/mail/cloudflare-email-outbound-transport-adapter";
import type { CloudflareEmailSendBinding } from "@/lib/mail/cloudflare-email-notification-transport-adapter";
import {
  R2OutboundAttachmentByteReader,
  resolveOutboundAttachmentStreamRefs,
} from "@/lib/mail/outbound-attachment-retrieval";
import type { OutboundBusinessEmailBindingEnv } from "@/lib/mail/outbound-business-email-binding";
import { resolveBusinessEmailBinding } from "@/lib/mail/outbound-business-email-binding";
import {
  isCloudflareOutboundProductionMode,
  resolveMailOutboundTransportMode,
} from "@/lib/mail/outbound-transport-constants";
import type { MailTransportAdapter } from "@/lib/mail/transport/mail-transport-adapter";

export type OutboundTransportWiringInput = OutboundBusinessEmailBindingEnv & {
  env: Record<string, string | undefined>;
  db?: Database;
  /** System notification EMAIL binding — never used for business outbound. */
  notificationEmailBinding?: CloudflareEmailSendBinding;
  attachmentsBucket?: InboundRawPayloadBucket;
};

/**
 * Resolves the outbound business-mail transport adapter for send-operation dispatch.
 * Production default: disabled mode — dispatch preflight blocks before provider invoke.
 * BUSINESS_EMAIL binding is required for production mode; EMAIL is never used as fallback.
 */
export function resolveOutboundMailTransportAdapter(
  input: OutboundTransportWiringInput,
): MailTransportAdapter {
  const transportMode = resolveMailOutboundTransportMode(input.env);
  const businessEmailBinding = resolveBusinessEmailBinding(input);

  return createCloudflareEmailOutboundTransport({
    transportMode,
    emailBinding: businessEmailBinding,
    attachmentReader:
      isCloudflareOutboundProductionMode(transportMode) && input.attachmentsBucket
        ? new R2OutboundAttachmentByteReader(input.attachmentsBucket)
        : undefined,
    resolveAttachmentRefs: input.db
      ? async (submission) =>
          resolveOutboundAttachmentStreamRefs(input.db!, submission.attachments)
      : undefined,
  });
}
