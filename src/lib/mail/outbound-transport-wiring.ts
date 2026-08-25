import type { Database } from "@/lib/db";
import type { InboundRawPayloadBucket } from "@/lib/mail/inbound-raw-payload-store";
import { createCloudflareEmailOutboundTransport } from "@/lib/mail/cloudflare-email-outbound-transport-adapter";
import type { CloudflareEmailSendBinding } from "@/lib/mail/cloudflare-email-notification-transport-adapter";
import {
  R2OutboundAttachmentByteReader,
  resolveOutboundAttachmentStreamRefs,
} from "@/lib/mail/outbound-attachment-retrieval";
import {
  isCloudflareOutboundProductionMode,
  resolveMailOutboundTransportMode,
} from "@/lib/mail/outbound-transport-constants";
import type { MailTransportAdapter } from "@/lib/mail/transport/mail-transport-adapter";

export type OutboundTransportWiringInput = {
  env: Record<string, string | undefined>;
  db?: Database;
  emailBinding?: CloudflareEmailSendBinding;
  attachmentsBucket?: InboundRawPayloadBucket;
};

/**
 * Resolves the outbound business-mail transport adapter for send-operation dispatch.
 * Production default: disabled mode — dispatch preflight blocks before provider invoke.
 */
export function resolveOutboundMailTransportAdapter(
  input: OutboundTransportWiringInput,
): MailTransportAdapter {
  const transportMode = resolveMailOutboundTransportMode(input.env);

  return createCloudflareEmailOutboundTransport({
    transportMode,
    emailBinding: input.emailBinding,
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
