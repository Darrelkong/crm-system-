import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  resolveLargeAttachmentR2Env,
  type LargeAttachmentR2Env,
} from "@/lib/mail/large-attachment/large-attachment-r2-env";
import type { LargeAttachmentObjectHeadResult } from "@/lib/mail/large-attachment/large-attachment-storage";

export type LargeAttachmentPresignedPutResult = {
  uploadUrl: string;
  requiredHeaders: {
    "Content-Type": string;
    "Content-MD5": string;
    "If-None-Match": "*";
  };
};

export function createLargeAttachmentS3Client(
  env: LargeAttachmentR2Env = resolveLargeAttachmentR2Env(),
): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: env.endpoint,
    credentials: {
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
    },
  });
}

export async function presignLargeAttachmentPut(input: {
  storageKey: string;
  contentType: string;
  contentMd5Base64: string;
  expiresInSeconds: number;
  env?: LargeAttachmentR2Env;
  client?: S3Client;
}): Promise<LargeAttachmentPresignedPutResult> {
  const env = input.env ?? resolveLargeAttachmentR2Env();
  const client = input.client ?? createLargeAttachmentS3Client(env);
  const command = new PutObjectCommand({
    Bucket: env.bucketName,
    Key: input.storageKey,
    ContentType: input.contentType,
    ContentMD5: input.contentMd5Base64,
    IfNoneMatch: "*",
  });
  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: input.expiresInSeconds,
  });
  return {
    uploadUrl,
    requiredHeaders: {
      "Content-Type": input.contentType,
      "Content-MD5": input.contentMd5Base64,
      "If-None-Match": "*",
    },
  };
}

function normalizeS3Etag(etag: string | undefined): string | null {
  if (!etag) {
    return null;
  }
  return etag.replace(/^"+|"+$/g, "").trim() || null;
}

export async function headLargeAttachmentObjectViaS3(input: {
  storageKey: string;
  env?: LargeAttachmentR2Env;
  client?: S3Client;
}): Promise<LargeAttachmentObjectHeadResult | null> {
  const env = input.env ?? resolveLargeAttachmentR2Env();
  const client = input.client ?? createLargeAttachmentS3Client(env);
  try {
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: env.bucketName,
        Key: input.storageKey,
      }),
    );
    return {
      storageKey: input.storageKey,
      sizeBytes: head.ContentLength ?? 0,
      etag: normalizeS3Etag(head.ETag),
      contentType: head.ContentType ?? null,
      storageVersion: null,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "NotFound" || name === "NoSuchKey") {
      return null;
    }
    throw error;
  }
}
