import SparkMD5 from "spark-md5";

interface Env {
  LARGE_ATTACHMENTS: R2Bucket;
  MAIL_LARGE_ATTACHMENT_LOCAL_RELAY_SECRET: string;
}

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const CONTENT_MD5_PATTERN =
  /^(?:[A-Za-z0-9+/]{22}==|[A-Za-z0-9+/]{23}=|[A-Za-z0-9+/]{24})$/;

function responseError(message: string, status = 400): Response {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function md5BinaryToBase64(value: string): string {
  return btoa(value);
}

function readAuthorizedKey(request: Request, env: Env): string | null {
  if (
    request.headers.get("x-crm-local-relay-secret") !==
    env.MAIL_LARGE_ATTACHMENT_LOCAL_RELAY_SECRET
  ) {
    return null;
  }
  const key = new URL(request.url).searchParams.get("key")?.trim();
  if (
    !key ||
    !key.startsWith("mail/large-attachments/") ||
    key.includes("..")
  ) {
    return null;
  }
  return key;
}

async function headObject(request: Request, env: Env): Promise<Response> {
  const key = readAuthorizedKey(request, env);
  if (!key) return responseError("Unauthorized", 401);
  const object = await env.LARGE_ATTACHMENTS.head(key);
  if (!object) return responseError("Not found", 404);
  return Response.json({
    sizeBytes: object.size,
    etag: object.httpEtag?.replace(/^"+|"+$/g, "") ?? object.etag ?? null,
    contentType:
      object.httpMetadata?.contentType ??
      object.customMetadata?.contentType ??
      null,
    storageVersion: object.version ?? null,
  });
}

async function deleteObject(request: Request, env: Env): Promise<Response> {
  const key = readAuthorizedKey(request, env);
  if (!key) return responseError("Unauthorized", 401);
  await env.LARGE_ATTACHMENTS.delete(key);
  return new Response(null, { status: 204 });
}

async function upload(request: Request, env: Env): Promise<Response> {
  const key = readAuthorizedKey(request, env);
  if (!key) return responseError("Unauthorized", 401);

  const contentType = request.headers.get("content-type")?.trim().toLowerCase();
  const contentMd5 = request.headers.get("content-md5")?.trim();
  const expectedSize = Number(
    request.headers.get("x-crm-large-attachment-expected-size"),
  );
  if (
    !contentType ||
    !contentMd5 ||
    !CONTENT_MD5_PATTERN.test(contentMd5) ||
    request.headers.get("if-none-match") !== "*" ||
    !Number.isSafeInteger(expectedSize) ||
    expectedSize <= 0 ||
    expectedSize > MAX_FILE_BYTES
  ) {
    return responseError("Invalid local upload headers");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) !== expectedSize) {
    return responseError("Upload size does not match authorization");
  }

  const existing = await env.LARGE_ATTACHMENTS.head(key);
  if (existing) {
    if (
      existing.size === expectedSize &&
      existing.httpMetadata?.contentType?.toLowerCase() === contentType &&
      existing.customMetadata?.["large-attachment-content-md5"] === contentMd5
    ) {
      return new Response(null, { status: 204 });
    }
    return responseError("An incompatible object already exists", 409);
  }

  if (!request.body) {
    return responseError("Upload body is required");
  }

  const md5 = new SparkMD5.ArrayBuffer();
  let observedSize = 0;
  const fixedLength = new FixedLengthStream(expectedSize);
  const transformed = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const bytes = new Uint8Array(chunk);
        observedSize += bytes.byteLength;
        if (observedSize > expectedSize) {
          controller.error(new Error("Upload exceeds authorized size"));
          return;
        }
        md5.append(
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer,
        );
        controller.enqueue(bytes);
      },
    }),
  );

  try {
    await Promise.all([
      env.LARGE_ATTACHMENTS.put(key, fixedLength.readable, {
        httpMetadata: { contentType },
        customMetadata: {
          "large-attachment-content-md5": contentMd5,
          "large-attachment-declared-sha256":
            request.headers.get("x-crm-large-attachment-declared-sha256") ?? "",
        },
      }),
      transformed.pipeTo(fixedLength.writable),
    ]);
  } catch {
    await env.LARGE_ATTACHMENTS.delete(key);
    return responseError("Local R2 upload failed");
  }

  const observedContentMd5 = md5BinaryToBase64(md5.end(true));
  if (observedSize !== expectedSize || observedContentMd5 !== contentMd5) {
    await env.LARGE_ATTACHMENTS.delete(key);
    return responseError("Uploaded object integrity check failed");
  }

  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/upload" && request.method === "PUT") {
      return upload(request, env);
    }
    if (pathname === "/head" && request.method === "GET") {
      return headObject(request, env);
    }
    if (pathname === "/delete" && request.method === "DELETE") {
      return deleteObject(request, env);
    }
    return responseError("Not found", 404);
  },
};

export default worker;
