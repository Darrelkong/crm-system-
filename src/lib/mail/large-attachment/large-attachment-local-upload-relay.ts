import SparkMD5 from "spark-md5";
import { MailServiceError } from "@/lib/mail/errors";
import { normalizeContentMd5Base64 } from "@/lib/mail/large-attachment/large-attachment-content-md5";
import type { LargeAttachmentUploadSession } from "@/lib/mail/large-attachment/large-attachment-upload-session";

export const LARGE_ATTACHMENT_LOCAL_RELAY_ENABLED_ENV =
  "MAIL_LARGE_ATTACHMENT_LOCAL_RELAY_ENABLED" as const;
export const LARGE_ATTACHMENT_LOCAL_RELAY_URL_ENV =
  "MAIL_LARGE_ATTACHMENT_LOCAL_RELAY_URL" as const;
export const LARGE_ATTACHMENT_LOCAL_RELAY_SECRET_ENV =
  "MAIL_LARGE_ATTACHMENT_LOCAL_RELAY_SECRET" as const;

type LocalRuntimeEnvironment = Record<string, string | undefined>;

export type LocalLargeAttachmentHead = {
  size: number;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
};

export type LocalLargeAttachmentBucket = {
  delete(key: string): Promise<void>;
  head(key: string): Promise<LocalLargeAttachmentHead | null>;
  put(
    key: string,
    value: Request | ReadableStream<Uint8Array>,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
};

export type LocalLargeAttachmentRelayTarget = {
  url: string;
  secret: string;
};

function readEnvironmentValue(
  env: LocalRuntimeEnvironment,
  name: string,
): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function isLocalLargeAttachmentRelayEnabled(
  env: LocalRuntimeEnvironment = process.env,
): boolean {
  const configured = env[LARGE_ATTACHMENT_LOCAL_RELAY_ENABLED_ENV]
    ?.trim()
    .toLowerCase();
  const nodeEnvironment = env.NODE_ENV?.trim().toLowerCase();
  return (
    nodeEnvironment === "development" &&
    (configured === "1" || configured === "true")
  );
}

export function resolveLocalLargeAttachmentRelayTarget(
  env: LocalRuntimeEnvironment = process.env,
): LocalLargeAttachmentRelayTarget | null {
  if (!isLocalLargeAttachmentRelayEnabled(env)) {
    return null;
  }
  const url = readEnvironmentValue(env, LARGE_ATTACHMENT_LOCAL_RELAY_URL_ENV);
  const secret = readEnvironmentValue(
    env,
    LARGE_ATTACHMENT_LOCAL_RELAY_SECRET_ENV,
  );
  return url && secret ? { url, secret } : null;
}

export function buildLocalLargeAttachmentUploadUrl(input: {
  draftId: string;
  sessionId: string;
}): string {
  return `/api/mail/drafts/${encodeURIComponent(input.draftId)}/large-attachments/${encodeURIComponent(input.sessionId)}/upload`;
}

function normalizeContentType(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function binaryMd5ToBase64(binaryMd5: string): string {
  return btoa(binaryMd5);
}

async function deleteObjectAfterRejectedUpload(
  bucket: LocalLargeAttachmentBucket,
  storageKey: string,
): Promise<void> {
  try {
    await bucket.delete(storageKey);
  } catch {
    // The original upload validation error is more useful to the caller.
  }
}

async function streamThroughLocalRelayWorker(input: {
  request: Request;
  target: LocalLargeAttachmentRelayTarget;
  session: LargeAttachmentUploadSession;
  expectedContentMd5: string;
}): Promise<{
  sizeBytes: number;
  contentMd5Base64: string;
}> {
  const digestRequest = input.request.clone();
  const digestBody = digestRequest.body;
  if (!digestBody) {
    throw MailServiceError.validation("Upload body is required", {
      issueCode: "EMPTY_UPLOAD_BODY",
    });
  }

  const md5 = new SparkMD5.ArrayBuffer();
  let observedSizeBytes = 0;
  const digestPromise = (async () => {
    const reader = digestBody.getReader();
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const bytes = new Uint8Array(next.value);
      observedSizeBytes += bytes.byteLength;
      if (
        observedSizeBytes > input.session.expectedSizeBytes ||
        observedSizeBytes > input.session.maxSizeBytes
      ) {
        throw new Error("Uploaded object exceeds authorized size");
      }
      md5.append(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      );
    }
  })();

  const forwardedHeaders: Record<string, string> = {
    "Content-Type": input.session.expectedMimeType,
    "Content-MD5": input.expectedContentMd5,
    "If-None-Match": "*",
    "X-CRM-Local-Relay-Secret": input.target.secret,
    "X-CRM-Large-Attachment-Expected-Size": String(
      input.session.expectedSizeBytes,
    ),
    "X-CRM-Large-Attachment-Declared-SHA256":
      input.session.declaredContentHash,
  };
  const contentLength = input.request.headers.get("content-length");
  if (contentLength) {
    forwardedHeaders["Content-Length"] = contentLength;
  }

  const relayUrl = `${input.target.url.replace(/\/+$/, "")}/upload?key=${encodeURIComponent(input.session.storageKey)}`;
  let relayResponse: Response;
  try {
    relayResponse = await Promise.all([
      fetch(relayUrl, {
        method: "PUT",
        headers: forwardedHeaders,
        body: input.request.body,
        duplex: "half",
      } as RequestInit),
      digestPromise,
    ]).then(([response]) => response);
  } catch {
    throw MailServiceError.validation("Local large attachment upload failed", {
      issueCode: "LOCAL_UPLOAD_FAILED",
    });
  }

  if (!relayResponse.ok) {
    throw MailServiceError.validation("Local large attachment upload failed", {
      issueCode: "LOCAL_UPLOAD_FAILED",
    });
  }

  const observedContentMd5 = binaryMd5ToBase64(md5.end(true));
  if (
    observedSizeBytes !== input.session.expectedSizeBytes ||
    observedContentMd5 !== input.expectedContentMd5
  ) {
    throw MailServiceError.validation("Uploaded object integrity check failed", {
      issueCode: "CONTENT_INTEGRITY_MISMATCH",
    });
  }

  return {
    sizeBytes: observedSizeBytes,
    contentMd5Base64: observedContentMd5,
  };
}

export async function streamLocalLargeAttachmentUpload(input: {
  request: Request;
  bucket: LocalLargeAttachmentBucket;
  session: LargeAttachmentUploadSession;
  relayTarget?: LocalLargeAttachmentRelayTarget;
}): Promise<{
  sizeBytes: number;
  contentMd5Base64: string;
  reusedExisting: boolean;
}> {
  const body = input.request.body;
  if (!body) {
    throw MailServiceError.validation("Upload body is required", {
      issueCode: "EMPTY_UPLOAD_BODY",
    });
  }

  const contentType = normalizeContentType(
    input.request.headers.get("content-type"),
  );
  const expectedContentType = normalizeContentType(
    input.session.expectedMimeType,
  );
  if (!contentType || contentType !== expectedContentType) {
    throw MailServiceError.validation("Uploaded object Content-Type mismatch", {
      issueCode: "CONTENT_TYPE_MISMATCH",
    });
  }

  const contentMd5Header = input.request.headers.get("content-md5");
  if (!contentMd5Header) {
    throw MailServiceError.validation("Content-MD5 header is required", {
      issueCode: "CONTENT_MD5_REQUIRED",
    });
  }
  const expectedContentMd5 = normalizeContentMd5Base64(contentMd5Header);

  if (input.request.headers.get("if-none-match") !== "*") {
    throw MailServiceError.validation("If-None-Match: * header is required", {
      issueCode: "IF_NONE_MATCH_REQUIRED",
    });
  }

  const contentLengthHeader = input.request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength !== input.session.expectedSizeBytes ||
      contentLength > input.session.maxSizeBytes
    ) {
      throw MailServiceError.validation("Uploaded object size does not match authorization", {
        issueCode: "SIZE_MISMATCH",
      });
    }
  }

  const existing = await input.bucket.head(input.session.storageKey);
  if (existing) {
    const existingContentType = normalizeContentType(
      existing.httpMetadata?.contentType,
    );
    const existingContentMd5 =
      existing.customMetadata?.["large-attachment-content-md5"];
    if (
      existing.size === input.session.expectedSizeBytes &&
      existingContentType === expectedContentType &&
      existingContentMd5 === expectedContentMd5
    ) {
      return {
        sizeBytes: existing.size,
        contentMd5Base64: expectedContentMd5,
        reusedExisting: true,
      };
    }
    throw MailServiceError.conflict("An incompatible object already exists", {
      issueCode: "OBJECT_ALREADY_EXISTS",
    });
  }

  if (input.relayTarget) {
    const streamed = await streamThroughLocalRelayWorker({
      request: input.request,
      target: input.relayTarget,
      session: input.session,
      expectedContentMd5,
    });
    return {
      ...streamed,
      reusedExisting: false,
    };
  }

  const md5 = new SparkMD5.ArrayBuffer();
  let observedSizeBytes = 0;
  const digestRequest = input.request.clone();
  const digestBody = digestRequest.body;
  if (!digestBody) {
    throw MailServiceError.validation("Upload body is required", {
      issueCode: "EMPTY_UPLOAD_BODY",
    });
  }
  const digestPromise = (async () => {
    const reader = digestBody.getReader();
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const bytes = new Uint8Array(next.value);
      observedSizeBytes += bytes.byteLength;
      if (
        observedSizeBytes > input.session.expectedSizeBytes ||
        observedSizeBytes > input.session.maxSizeBytes
      ) {
        throw new Error("Uploaded object exceeds authorized size");
      }
      md5.append(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      );
    }
  })();

  try {
    await Promise.all([
      input.bucket.put(input.session.storageKey, input.request, {
        httpMetadata: { contentType: input.session.expectedMimeType },
        customMetadata: {
          "large-attachment-content-md5": expectedContentMd5,
          "large-attachment-declared-sha256": input.session.declaredContentHash,
        },
      }),
      digestPromise,
    ]);
  } catch {
    await deleteObjectAfterRejectedUpload(input.bucket, input.session.storageKey);
    throw MailServiceError.validation("Local large attachment upload failed", {
      issueCode: "LOCAL_UPLOAD_FAILED",
    });
  }

  const observedContentMd5 = binaryMd5ToBase64(md5.end(true));
  if (
    observedSizeBytes !== input.session.expectedSizeBytes ||
    observedContentMd5 !== expectedContentMd5
  ) {
    await deleteObjectAfterRejectedUpload(input.bucket, input.session.storageKey);
    throw MailServiceError.validation("Uploaded object integrity check failed", {
      issueCode: "CONTENT_INTEGRITY_MISMATCH",
    });
  }

  return {
    sizeBytes: observedSizeBytes,
    contentMd5Base64: observedContentMd5,
    reusedExisting: false,
  };
}
