import { getCloudflareContext } from "@opennextjs/cloudflare";
import { LARGE_ATTACHMENT_DEDICATED_BUCKET_NAME } from "@/lib/mail/large-attachment/large-attachment-constants";

/** Canonical Production secret names — values must never be committed. */
export const LARGE_ATTACHMENT_R2_ACCESS_KEY_ID_ENV =
  "R2_LARGE_ATTACHMENT_ACCESS_KEY_ID" as const;
export const LARGE_ATTACHMENT_R2_SECRET_ACCESS_KEY_ENV =
  "R2_LARGE_ATTACHMENT_SECRET_ACCESS_KEY" as const;
export const CLOUDFLARE_ACCOUNT_ID_ENV = "CLOUDFLARE_ACCOUNT_ID" as const;

/** Local/dev fallback names used during Phase 2B proof — not canonical Production names. */
const LEGACY_R2_S3_ACCESS_KEY_ID_ENV = "R2_S3_ACCESS_KEY_ID" as const;
const LEGACY_R2_S3_SECRET_ACCESS_KEY_ENV = "R2_S3_SECRET_ACCESS_KEY" as const;

export type LargeAttachmentR2Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  accountId: string;
};

export type LargeAttachmentR2Env = LargeAttachmentR2Credentials & {
  bucketName: typeof LARGE_ATTACHMENT_DEDICATED_BUCKET_NAME;
  endpoint: string;
};

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

export function resolveLargeAttachmentR2Credentials(): LargeAttachmentR2Credentials {
  const accessKeyId =
    readEnv(LARGE_ATTACHMENT_R2_ACCESS_KEY_ID_ENV) ??
    readEnv(LEGACY_R2_S3_ACCESS_KEY_ID_ENV);
  const secretAccessKey =
    readEnv(LARGE_ATTACHMENT_R2_SECRET_ACCESS_KEY_ENV) ??
    readEnv(LEGACY_R2_S3_SECRET_ACCESS_KEY_ENV);
  const accountId = readEnv(CLOUDFLARE_ACCOUNT_ID_ENV);

  if (!accessKeyId || !secretAccessKey || !accountId) {
    throw new Error(
      "Large attachment R2 S3 credentials are not configured for presign/HEAD",
    );
  }

  return { accessKeyId, secretAccessKey, accountId };
}

export function buildLargeAttachmentR2S3Endpoint(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

export function resolveLargeAttachmentR2Env(): LargeAttachmentR2Env {
  const credentials = resolveLargeAttachmentR2Credentials();
  return {
    ...credentials,
    bucketName: LARGE_ATTACHMENT_DEDICATED_BUCKET_NAME,
    endpoint: buildLargeAttachmentR2S3Endpoint(credentials.accountId),
  };
}

export function getLargeAttachmentsR2Bucket(): CloudflareEnv["LARGE_ATTACHMENTS"] {
  try {
    const { env } = getCloudflareContext();
    return (env as CloudflareEnv).LARGE_ATTACHMENTS ?? undefined;
  } catch {
    return undefined;
  }
}
