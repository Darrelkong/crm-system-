import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cache } from "react";
import type { InboundRawPayloadBucket } from "@/lib/mail/inbound-raw-payload-store";

export const MAIL_ATTACHMENTS_R2_BUCKET_NAME = "crm-attachments" as const;

export const getAttachmentsBucket = cache((): InboundRawPayloadBucket => {
  const { env } = getCloudflareContext();
  const bucket = env.ATTACHMENTS as InboundRawPayloadBucket | undefined;
  if (!bucket) {
    throw new Error("ATTACHMENTS R2 binding is required");
  }
  return bucket;
});
