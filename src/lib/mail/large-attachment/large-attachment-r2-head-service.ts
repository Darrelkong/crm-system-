import { getLargeAttachmentsR2Bucket } from "@/lib/mail/large-attachment/large-attachment-r2-env";
import { headLargeAttachmentObjectViaS3 } from "@/lib/mail/large-attachment/large-attachment-r2-s3-client";
import { resolveLocalLargeAttachmentRelayTarget } from "@/lib/mail/large-attachment/large-attachment-local-upload-relay";
import type { LargeAttachmentObjectHeadResult } from "@/lib/mail/large-attachment/large-attachment-storage";

export type LargeAttachmentAuthoritativeHeadResult = LargeAttachmentObjectHeadResult & {
  storageVersion: string | null;
  versionProof: "worker_binding" | "deferred_s3_head";
};

async function headLargeAttachmentObjectViaLocalRelay(
  storageKey: string,
  target: { url: string; secret: string },
): Promise<LargeAttachmentAuthoritativeHeadResult | null> {
  const response = await fetch(
    `${target.url.replace(/\/+$/, "")}/head?key=${encodeURIComponent(storageKey)}`,
    {
      headers: { "X-CRM-Local-Relay-Secret": target.secret },
    },
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Local large attachment HEAD failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    sizeBytes?: number;
    etag?: string | null;
    contentType?: string | null;
    storageVersion?: string | null;
  };
  return {
    storageKey,
    sizeBytes: payload.sizeBytes ?? 0,
    etag: payload.etag ?? null,
    contentType: payload.contentType ?? null,
    storageVersion: payload.storageVersion ?? null,
    versionProof: "worker_binding",
  };
}

export async function headLargeAttachmentObjectAuthoritative(
  storageKey: string,
): Promise<LargeAttachmentAuthoritativeHeadResult | null> {
  const localRelayTarget = resolveLocalLargeAttachmentRelayTarget();
  if (localRelayTarget) {
    return headLargeAttachmentObjectViaLocalRelay(storageKey, localRelayTarget);
  }

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
