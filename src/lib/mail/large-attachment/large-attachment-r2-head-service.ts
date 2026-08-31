import { getLargeAttachmentsR2Bucket } from "@/lib/mail/large-attachment/large-attachment-r2-env";
import { headLargeAttachmentObjectViaS3 } from "@/lib/mail/large-attachment/large-attachment-r2-s3-client";
import type { LargeAttachmentObjectHeadResult } from "@/lib/mail/large-attachment/large-attachment-storage";

export type LargeAttachmentAuthoritativeHeadResult = LargeAttachmentObjectHeadResult & {
  storageVersion: string | null;
  versionProof: "worker_binding" | "deferred_s3_head";
};

export async function headLargeAttachmentObjectAuthoritative(
  storageKey: string,
): Promise<LargeAttachmentAuthoritativeHeadResult | null> {
  const binding = getLargeAttachmentsR2Bucket();
  if (binding) {
    const object = await binding.head(storageKey);
    if (!object) {
      return null;
    }
    return {
      storageKey,
      sizeBytes: object.size,
      etag: object.httpEtag?.replace(/^"+|"+$/g, "") ?? object.etag ?? null,
      contentType: object.httpMetadata?.contentType ?? object.customMetadata?.contentType ?? null,
      storageVersion: object.version ?? null,
      versionProof: "worker_binding",
    };
  }

  const s3Head = await headLargeAttachmentObjectViaS3({ storageKey });
  if (!s3Head) {
    return null;
  }
  return {
    ...s3Head,
    storageVersion: null,
    versionProof: "deferred_s3_head",
  };
}
