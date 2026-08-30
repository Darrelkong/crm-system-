import type { DraftDetailApiItem } from "@/lib/mail/client/draft-management";
import {
  draftAttachmentPath,
  draftAttachmentsPath,
} from "@/lib/mail/client/draft-management";
import {
  composeAttachmentLimitI18nParams,
  type ComposeAttachmentPolicyIssueCode,
  validateComposeAttachmentCandidate,
} from "@/lib/mail/compose-attachment-policy";

export type ComposeAttachmentUploadStatus =
  | "queued"
  | "uploading"
  | "uploaded"
  | "failed"
  | "cancelled";

export type ComposeAttachmentUploadErrorCode =
  | ComposeAttachmentPolicyIssueCode
  | "DRAFT_SAVE_FAILED"
  | "DRAFT_NOT_PERSISTED"
  | "MISSING_FROM"
  | "UPLOAD_FILE_MISSING";

export type ComposeAttachmentUploadState = {
  localId: string;
  serverId: string | null;
  name: string;
  sizeBytes: number;
  sizeLabel: string;
  kind: "attachment" | "secure_file";
  uploadStatus: ComposeAttachmentUploadStatus;
  uploadProgress: number;
  error: string | null;
  errorCode: ComposeAttachmentUploadErrorCode | null;
  file: File | null;
};

export function composeAttachmentRemoveMessageKey(): string {
  return "mail.compose.attachment.removeAttachment";
}

export function composeAttachmentPolicyErrorParams(
  code: ComposeAttachmentPolicyIssueCode,
): Record<string, string> | undefined {
  const limits = composeAttachmentLimitI18nParams();
  switch (code) {
    case "FILE_TOO_LARGE":
      return { size: limits.size };
    case "TOTAL_SIZE_EXCEEDED":
      return { totalSize: limits.totalSize };
    case "TOO_MANY_ATTACHMENTS":
      return { maxCount: limits.maxCount };
    default:
      return undefined;
  }
}

export function composeAttachmentUploadErrorMessageKey(
  errorCode: ComposeAttachmentUploadErrorCode | null | undefined,
): string {
  switch (errorCode) {
    case "DRAFT_SAVE_FAILED":
      return "mail.compose.attachment.draftSaveFailed";
    case "DRAFT_NOT_PERSISTED":
      return "mail.compose.attachment.draftNotSavedDetail";
    case "MISSING_FROM":
      return "mail.compose.attachment.missingFrom";
    case "UPLOAD_FILE_MISSING":
      return "mail.compose.attachment.uploadFileMissing";
    case "FILE_TOO_LARGE":
      return "mail.compose.attachment.fileTooLarge";
    case "TOTAL_SIZE_EXCEEDED":
      return "mail.compose.attachment.totalSizeExceeded";
    case "TOO_MANY_ATTACHMENTS":
      return "mail.compose.attachment.tooMany";
    case "UNSUPPORTED_FILE_TYPE":
      return "mail.compose.attachment.unsupportedType";
    case "EMPTY_FILE":
      return "mail.compose.attachment.emptyFile";
    case "FILENAME_REQUIRED":
      return "mail.compose.attachment.filenameRequired";
    default:
      return "mail.compose.attachment.uploadFailed";
  }
}

export function isAttachmentPendingUpload(
  attachment: Pick<ComposeAttachmentUploadState, "uploadStatus">,
): boolean {
  return (
    attachment.uploadStatus === "queued" ||
    attachment.uploadStatus === "uploading"
  );
}

export function validateLocalAttachmentFile(
  file: File,
  existing: Pick<ComposeAttachmentUploadState, "sizeBytes" | "uploadStatus">[],
): { ok: true } | { ok: false; error: string; errorCode: ComposeAttachmentPolicyIssueCode } {
  const active = existing.filter(
    (attachment) =>
      attachment.uploadStatus === "uploaded" ||
      attachment.uploadStatus === "queued" ||
      attachment.uploadStatus === "uploading",
  );
  const issue = validateComposeAttachmentCandidate({
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    existingAttachmentCount: active.length,
    existingTotalBytes: active.reduce(
      (sum, attachment) => sum + attachment.sizeBytes,
      0,
    ),
  });
  if (issue) {
    return { ok: false, error: issue.message, errorCode: issue.code };
  }
  return { ok: true };
}

export function createQueuedAttachmentEntry(
  file: File,
  formatSize: (bytes: number) => string,
): ComposeAttachmentUploadState {
  return {
    localId: crypto.randomUUID(),
    serverId: null,
    name: file.name,
    sizeBytes: file.size,
    sizeLabel: formatSize(file.size),
    kind: "attachment",
    uploadStatus: "queued",
    uploadProgress: 0,
    error: null,
    errorCode: null,
    file,
  };
}

export function mergeUploadedDraftAttachments(
  current: ComposeAttachmentUploadState[],
  item: DraftDetailApiItem,
  formatSize: (bytes?: number) => string,
): ComposeAttachmentUploadState[] {
  const serverById = new Map(item.attachments.map((attachment) => [attachment.id, attachment]));
  const retainedPending = current.filter(
    (attachment) =>
      attachment.uploadStatus === "queued" ||
      attachment.uploadStatus === "uploading" ||
      attachment.uploadStatus === "failed",
  );

  const uploaded = item.attachments.map((attachment) => ({
    localId: attachment.id,
    serverId: attachment.id,
    name: attachment.displayFilename,
    sizeBytes: attachment.sizeBytes ?? 0,
    sizeLabel: formatSize(attachment.sizeBytes),
    kind: attachment.deliveryMode,
    uploadStatus: "uploaded" as const,
    uploadProgress: 100,
    error: null,
    errorCode: null,
    file: null,
  }));

  const pendingWithoutDupes = retainedPending.filter(
    (attachment) =>
      !attachment.serverId || !serverById.has(attachment.serverId),
  );

  return [...uploaded, ...pendingWithoutDupes];
}

type UploadResult =
  | { ok: true; item: DraftDetailApiItem }
  | {
      ok: false;
      status: number;
      error: string;
      errorCode?: string;
      cancelled?: boolean;
    };

export function uploadDraftAttachmentWithProgress(input: {
  draftId: string;
  file: File;
  expectedAutosaveVersion: number;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}): Promise<UploadResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", draftAttachmentsPath(input.draftId));

    const abortHandler = () => {
      xhr.abort();
    };
    input.signal?.addEventListener("abort", abortHandler, { once: true });

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      input.onProgress?.(percent);
    };

    xhr.onload = () => {
      input.signal?.removeEventListener("abort", abortHandler);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as {
            item: DraftDetailApiItem;
          };
          resolve({ ok: true, item: data.item });
          return;
        } catch {
          resolve({
            ok: false,
            status: xhr.status,
            error: "Invalid upload response",
          });
          return;
        }
      }

      let error = "Failed to upload attachment";
      let errorCode: string | undefined;
      try {
        const data = JSON.parse(xhr.responseText) as {
          error?: string;
          errorCode?: string;
        };
        error = data.error ?? error;
        errorCode = data.errorCode;
      } catch {
        // ignore parse errors
      }
      resolve({ ok: false, status: xhr.status, error, errorCode });
    };

    xhr.onerror = () => {
      input.signal?.removeEventListener("abort", abortHandler);
      resolve({
        ok: false,
        status: xhr.status || 0,
        error: "Network error during attachment upload",
      });
    };

    xhr.onabort = () => {
      input.signal?.removeEventListener("abort", abortHandler);
      resolve({
        ok: false,
        status: 0,
        error: "Upload cancelled",
        cancelled: true,
      });
    };

    const formData = new FormData();
    formData.append("file", input.file);
    formData.append(
      "expectedAutosaveVersion",
      String(input.expectedAutosaveVersion),
    );
    xhr.send(formData);
  });
}

export async function deleteDraftAttachment(input: {
  draftId: string;
  attachmentId: string;
  expectedAutosaveVersion: number;
}): Promise<
  | { ok: true; item: DraftDetailApiItem }
  | { ok: false; status: number; error: string; errorCode?: string }
> {
  const res = await fetch(draftAttachmentPath(input.draftId, input.attachmentId), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      expectedAutosaveVersion: input.expectedAutosaveVersion,
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      errorCode?: string;
    };
    return {
      ok: false,
      status: res.status,
      error: data.error ?? "Failed to remove attachment",
      errorCode: data.errorCode,
    };
  }
  const data = (await res.json()) as { item: DraftDetailApiItem };
  return { ok: true, item: data.item };
}

export function buildAttachmentPolicyMessageKey(
  code: ComposeAttachmentPolicyIssueCode,
): string {
  switch (code) {
    case "FILE_TOO_LARGE":
      return "mail.compose.attachment.fileTooLarge";
    case "TOTAL_SIZE_EXCEEDED":
      return "mail.compose.attachment.totalSizeExceeded";
    case "TOO_MANY_ATTACHMENTS":
      return "mail.compose.attachment.tooMany";
    case "UNSUPPORTED_FILE_TYPE":
      return "mail.compose.attachment.unsupportedType";
    case "EMPTY_FILE":
      return "mail.compose.attachment.emptyFile";
    case "FILENAME_REQUIRED":
      return "mail.compose.attachment.filenameRequired";
    default:
      return "mail.compose.attachment.uploadFailed";
  }
}
