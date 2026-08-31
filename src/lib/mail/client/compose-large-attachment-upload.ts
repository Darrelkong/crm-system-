import type { DraftDetailApiItem } from "@/lib/mail/client/draft-management";
import {
  draftLargeAttachmentFinalizePath,
  draftLargeAttachmentsAuthorizePath,
} from "@/lib/mail/client/draft-management";
import { computeFileContentDigests } from "@/lib/mail/client/file-content-digests";

export type LargeAttachmentAuthorizeResponse = {
  uploadSessionId: string;
  uploadUrl: string;
  requiredHeaders: {
    "Content-Type": string;
    "Content-MD5": string;
    "If-None-Match": "*";
  };
  expiresAt: string;
};

export type LargeUploadResult =
  | { ok: true; item: DraftDetailApiItem }
  | {
      ok: false;
      status: number;
      error: string;
      errorCode?: string;
      cancelled?: boolean;
      uploadSessionId?: string;
      putCompleted?: boolean;
    };

export async function authorizeLargeAttachmentUpload(input: {
  draftId: string;
  file: File;
  declaredSha256: string;
  contentMd5Base64: string;
  signal?: AbortSignal;
}): Promise<
  | { ok: true; authorization: LargeAttachmentAuthorizeResponse }
  | { ok: false; status: number; error: string; errorCode?: string }
> {
  const response = await fetch(draftLargeAttachmentsAuthorizePath(input.draftId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: input.file.name,
      mimeType: input.file.type || "application/octet-stream",
      sizeBytes: input.file.size,
      declaredSha256: input.declaredSha256,
      contentMd5: input.contentMd5Base64,
    }),
    signal: input.signal,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    errorCode?: string;
    uploadSessionId?: string;
    uploadUrl?: string;
    requiredHeaders?: LargeAttachmentAuthorizeResponse["requiredHeaders"];
    expiresAt?: string;
  };
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload.error ?? "Large attachment authorization failed",
      errorCode: payload.errorCode,
    };
  }
  if (
    !payload.uploadSessionId ||
    !payload.uploadUrl ||
    !payload.requiredHeaders ||
    !payload.expiresAt
  ) {
    return {
      ok: false,
      status: 500,
      error: "Large attachment authorization response incomplete",
    };
  }
  return {
    ok: true,
    authorization: {
      uploadSessionId: payload.uploadSessionId,
      uploadUrl: payload.uploadUrl,
      requiredHeaders: payload.requiredHeaders,
      expiresAt: payload.expiresAt,
    },
  };
}

export function buildLargeAttachmentR2PutHeaders(
  authorization: LargeAttachmentAuthorizeResponse,
): Record<string, string> {
  return {
    "Content-Type": authorization.requiredHeaders["Content-Type"],
    "Content-MD5": authorization.requiredHeaders["Content-MD5"],
    "If-None-Match": authorization.requiredHeaders["If-None-Match"],
  };
}

export function putLargeAttachmentToR2WithProgress(input: {
  authorization: LargeAttachmentAuthorizeResponse;
  file: File;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}): Promise<
  | { ok: true }
  | { ok: false; status: number; error: string; cancelled?: boolean }
> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", input.authorization.uploadUrl);
    const headers = buildLargeAttachmentR2PutHeaders(input.authorization);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }

    const abortHandler = () => xhr.abort();
    input.signal?.addEventListener("abort", abortHandler, { once: true });

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      input.onProgress?.(percent);
    };

    xhr.onload = () => {
      input.signal?.removeEventListener("abort", abortHandler);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ ok: true });
        return;
      }
      resolve({
        ok: false,
        status: xhr.status,
        error: "Large attachment upload to storage failed",
      });
    };
    xhr.onerror = () => {
      input.signal?.removeEventListener("abort", abortHandler);
      resolve({ ok: false, status: 0, error: "Large attachment upload network error" });
    };
    xhr.onabort = () => {
      input.signal?.removeEventListener("abort", abortHandler);
      resolve({ ok: false, status: 0, error: "Upload cancelled", cancelled: true });
    };
    xhr.send(input.file);
  });
}

export async function finalizeLargeAttachmentUpload(input: {
  draftId: string;
  sessionId: string;
  expectedAutosaveVersion: number;
  signal?: AbortSignal;
}): Promise<LargeUploadResult> {
  const response = await fetch(
    draftLargeAttachmentFinalizePath(input.draftId, input.sessionId),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedAutosaveVersion: input.expectedAutosaveVersion,
      }),
      signal: input.signal,
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    item?: DraftDetailApiItem;
    error?: string;
    errorCode?: string;
  };
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload.error ?? "Large attachment finalize failed",
      errorCode: payload.errorCode,
    };
  }
  if (!payload.item) {
    return {
      ok: false,
      status: 500,
      error: "Large attachment finalize response incomplete",
    };
  }
  return { ok: true, item: payload.item };
}

export async function uploadLargeDraftAttachmentWithProgress(input: {
  draftId: string;
  file: File;
  expectedAutosaveVersion: number;
  signal?: AbortSignal;
  onPhase?: (phase: "hashing" | "authorizing" | "uploading" | "finalizing") => void;
  onProgress?: (percent: number) => void;
  finalizeOnly?: { uploadSessionId: string };
}): Promise<LargeUploadResult> {
  if (input.finalizeOnly) {
    input.onPhase?.("finalizing");
    const finalizeResult = await finalizeLargeAttachmentUpload({
      draftId: input.draftId,
      sessionId: input.finalizeOnly.uploadSessionId,
      expectedAutosaveVersion: input.expectedAutosaveVersion,
      signal: input.signal,
    });
    if (!finalizeResult.ok) {
      return {
        ...finalizeResult,
        uploadSessionId: input.finalizeOnly.uploadSessionId,
        putCompleted: true,
      };
    }
    return finalizeResult;
  }

  input.onPhase?.("hashing");
  const digests = await computeFileContentDigests(input.file);
  if (input.signal?.aborted) {
    return { ok: false, status: 0, error: "Upload cancelled", cancelled: true };
  }

  input.onPhase?.("authorizing");
  const authorized = await authorizeLargeAttachmentUpload({
    draftId: input.draftId,
    file: input.file,
    declaredSha256: digests.declaredSha256,
    contentMd5Base64: digests.contentMd5Base64,
    signal: input.signal,
  });
  if (!authorized.ok) {
    return authorized;
  }

  input.onPhase?.("uploading");
  const putResult = await putLargeAttachmentToR2WithProgress({
    authorization: authorized.authorization,
    file: input.file,
    signal: input.signal,
    onProgress: input.onProgress,
  });
  if (!putResult.ok) {
    return putResult;
  }

  input.onPhase?.("finalizing");
  const finalizeResult = await finalizeLargeAttachmentUpload({
    draftId: input.draftId,
    sessionId: authorized.authorization.uploadSessionId,
    expectedAutosaveVersion: input.expectedAutosaveVersion,
    signal: input.signal,
  });
  if (!finalizeResult.ok) {
    return {
      ...finalizeResult,
      uploadSessionId: authorized.authorization.uploadSessionId,
      putCompleted: true,
    };
  }
  return finalizeResult;
}
