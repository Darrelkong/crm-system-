import {
  CRM_SYSTEM_GATEWAY_SECRET_HEADER,
  CRM_SYSTEM_LARGE_ATTACHMENT_GATEWAY_RPC_PATH,
  type LargeAttachmentInternalDownloadAuthorizationGranted,
} from "../../src/lib/mail/large-attachment/large-attachment-download-authorization";
import { resolveMailAttachmentDownloadContentType } from "../../src/lib/mail/mail-attachment-download-content-type";
import { buildMailAttachmentContentDispositionHeader } from "../../src/lib/mail/mail-attachment-download-content-disposition";
import { assertLargeAttachmentStorageKey } from "../../src/lib/mail/large-attachment/large-attachment-storage-key";
import type { EchfrontMailFilesEnv } from "./env.types";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const STORAGE_IDENTITY_UNAVAILABLE = Symbol("storage-identity-unavailable");

function unavailableResponse(): Response {
  return new Response(
    "附件暂不可用\n该下载链接可能已过期或文件已被撤回。\n\nAttachment unavailable.",
    {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function methodNotAllowedResponse(): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: {
      Allow: "GET",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function extractOpaqueToken(url: URL): { token: string; download: boolean } | null {
  if (url.search) {
    return null;
  }

  const prefix = "/f/";
  if (!url.pathname.startsWith(prefix)) {
    return null;
  }
  const pathValue = url.pathname.slice(prefix.length);
  const download = pathValue.endsWith("/download");
  const encodedToken = download
    ? pathValue.slice(0, -"/download".length)
    : pathValue;
  if (!encodedToken || encodedToken.includes("/")) {
    return null;
  }

  let token: string;
  try {
    token = decodeURIComponent(encodedToken);
  } catch {
    return null;
  }
  if (token !== encodedToken || !TOKEN_PATTERN.test(token)) {
    return null;
  }
  return { token, download };
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}

function warningResponse(
  request: Request,
  metadata: LargeAttachmentInternalDownloadAuthorizationGranted,
): Response {
  const downloadUrl = `${new URL(request.url).pathname}/download`;
  const filename = escapeHtml(metadata.filename);
  return new Response(
    `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>文件安全提示</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f7fa; color: #172033; }
  main { width: min(92vw, 34rem); box-sizing: border-box; padding: 1.5rem; border: 1px solid #d9dee8; border-radius: 1rem; background: white; box-shadow: 0 12px 32px #17203318; }
  h1 { margin: 0 0 1rem; font-size: 1.25rem; }
  p { line-height: 1.75; }
  .filename { overflow-wrap: anywhere; color: #526071; }
  a { display: inline-block; margin-top: .75rem; padding: .7rem 1rem; border-radius: .6rem; background: #2563eb; color: white; text-decoration: none; font-weight: 600; }
  @media (prefers-color-scheme: dark) { body { background: #111827; color: #f3f4f6; } main { border-color: #374151; background: #1f2937; } .filename { color: #cbd5e1; } }
</style>
</head>
<body>
<main>
<h1>文件安全提示</h1>
<p>该文件由发送方提供，系统未进行自动安全扫描。请确认文件来源可信并自行甄别后下载或打开。</p>
<p class="filename">${filename}</p>
<a href="${escapeHtml(downloadUrl)}">继续下载</a>
</main>
</body>
</html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function isGrantedAuthorization(
  value: unknown,
): value is LargeAttachmentInternalDownloadAuthorizationGranted {
  if (!value || typeof value !== "object") {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    result.authorized === true &&
    typeof result.lifecycleId === "string" &&
    typeof result.storageKey === "string" &&
    typeof result.filename === "string" &&
    typeof result.mimeType === "string" &&
    typeof result.sizeBytes === "number" &&
    Number.isSafeInteger(result.sizeBytes) &&
    result.sizeBytes >= 0 &&
    (typeof result.storageVersion === "string" ||
      result.storageVersion === null) &&
    (typeof result.storageEtag === "string" || result.storageEtag === null) &&
    typeof result.recipientExpiresAt === "string"
  );
}

async function requestCrmAuthorization(
  env: EchfrontMailFilesEnv,
  body: unknown,
): Promise<Response> {
  if (!env.CRM_SYSTEM_GATEWAY_SECRET) {
    return new Response(null, { status: 503 });
  }
  return env.CRM_SYSTEM.fetch(
    `https://crm-system-local${CRM_SYSTEM_LARGE_ATTACHMENT_GATEWAY_RPC_PATH}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CRM_SYSTEM_GATEWAY_SECRET_HEADER]: env.CRM_SYSTEM_GATEWAY_SECRET,
      },
      body: JSON.stringify(body),
    },
  );
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function hasExpectedStorageIdentity(
  object: Pick<R2Object, "size" | "etag" | "version">,
  metadata: LargeAttachmentInternalDownloadAuthorizationGranted,
): boolean {
  if (object.size !== metadata.sizeBytes) {
    return false;
  }
  if (
    metadata.storageEtag !== null &&
    object.etag !== metadata.storageEtag
  ) {
    return false;
  }
  if (
    metadata.storageVersion !== null &&
    object.version !== metadata.storageVersion
  ) {
    return false;
  }
  return true;
}

async function resolveAuthorizedR2Object(
  env: EchfrontMailFilesEnv,
  metadata: LargeAttachmentInternalDownloadAuthorizationGranted,
): Promise<R2ObjectBody | typeof STORAGE_IDENTITY_UNAVAILABLE> {
  try {
    assertLargeAttachmentStorageKey(metadata.storageKey);
  } catch {
    return STORAGE_IDENTITY_UNAVAILABLE;
  }

  try {
    const head = await env.LARGE_ATTACHMENTS.head(metadata.storageKey);
    if (!head || !hasExpectedStorageIdentity(head, metadata)) {
      return STORAGE_IDENTITY_UNAVAILABLE;
    }

    const object = await env.LARGE_ATTACHMENTS.get(metadata.storageKey);
    if (
      !object ||
      !object.body ||
      !hasExpectedStorageIdentity(object, metadata)
    ) {
      return STORAGE_IDENTITY_UNAVAILABLE;
    }
    return object;
  } catch {
    return STORAGE_IDENTITY_UNAVAILABLE;
  }
}

export async function handleEchfrontMailFilesRequest(
  request: Request,
  env: EchfrontMailFilesEnv,
  now: () => Date = () => new Date(),
): Promise<Response> {
  if (request.method !== "GET") {
    return methodNotAllowedResponse();
  }

  const parsedToken = extractOpaqueToken(new URL(request.url));
  if (!parsedToken) {
    return unavailableResponse();
  }

  const tokenHash = await sha256Hex(parsedToken.token);
  let authorizationResponse: Response;
  try {
    authorizationResponse = await requestCrmAuthorization(env, {
      action: "authorize",
      tokenHash,
      trustNowIso: now().toISOString(),
    });
  } catch {
    return unavailableResponse();
  }
  if (!authorizationResponse.ok) {
    return unavailableResponse();
  }

  let authorization: unknown;
  try {
    authorization = await authorizationResponse.json();
  } catch {
    return unavailableResponse();
  }
  if (!isGrantedAuthorization(authorization)) {
    return unavailableResponse();
  }

  if (!parsedToken.download) {
    return warningResponse(request, authorization);
  }

  const object = await resolveAuthorizedR2Object(env, authorization);
  if (object === STORAGE_IDENTITY_UNAVAILABLE) {
    console.error(
      "[echfront-mail-files] authorized object failed storage identity check",
    );
    return unavailableResponse();
  }

  let accountingResponse: Response;
  try {
    accountingResponse = await requestCrmAuthorization(env, {
      action: "record",
      lifecycleId: authorization.lifecycleId,
      tokenHash,
      downloadedAt: now().toISOString(),
    });
  } catch {
    return unavailableResponse();
  }
  if (!accountingResponse.ok) {
    return unavailableResponse();
  }
  let accounting: unknown;
  try {
    accounting = await accountingResponse.json();
  } catch {
    return unavailableResponse();
  }
  if (
    !accounting ||
    typeof accounting !== "object" ||
    (accounting as { recorded?: unknown }).recorded !== true
  ) {
    return unavailableResponse();
  }

  const headers = new Headers({
    "Content-Type": resolveMailAttachmentDownloadContentType(
      authorization.mimeType,
    ),
    "Content-Disposition": buildMailAttachmentContentDispositionHeader(
      authorization.filename,
      "attachment",
    ),
    "Content-Length": String(authorization.sizeBytes),
    "Cache-Control": "private, no-store",
    "Content-Security-Policy":
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "none",
  });

  // V1 intentionally ignores Range and streams the complete object. A
  // fragile custom range reader could leak bytes across authorization checks.
  return new Response(object.body, { status: 200, headers });
}

const worker = {
  fetch(request: Request, env: EchfrontMailFilesEnv): Promise<Response> {
    return handleEchfrontMailFilesRequest(request, env);
  },
};

export default worker;
