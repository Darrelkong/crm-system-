import { MailReadApiError } from "@/lib/mail/client/mail-read-api-errors";
import type {
  MailReadFolder,
  MailReadStatePatch,
} from "@/lib/mail/client/mail-read-types";

export const MAIL_READ_FOLDERS = ["inbox", "sent", "trash"] as const;

export const MAIL_READ_DEFAULT_LIMIT = 50;
export const MAIL_READ_MAX_LIMIT = 100;

export function isMailReadFolder(value: string): value is MailReadFolder {
  return (
    value === "inbox" || value === "sent" || value === "trash"
  );
}

export function validateFolder(folder: string): MailReadFolder {
  if (!isMailReadFolder(folder)) {
    throw MailReadApiError.validation(
      "folder must be one of: inbox, sent, trash",
    );
  }
  return folder;
}

export function validateOptionalFolder(
  folder: string | undefined,
): MailReadFolder | undefined {
  if (folder == null || folder === "") {
    return undefined;
  }
  return validateFolder(folder);
}

export function validateRequiredId(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw MailReadApiError.validation(`${fieldName} is required`);
  }
  return trimmed;
}

export function validatePagination(limit?: number): number | undefined {
  if (limit == null) {
    return undefined;
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    throw MailReadApiError.validation("limit must be a positive integer");
  }
  const normalized = Math.floor(limit);
  if (normalized > MAIL_READ_MAX_LIMIT) {
    throw MailReadApiError.validation(
      `limit must not exceed ${MAIL_READ_MAX_LIMIT}`,
    );
  }
  return normalized;
}

export function validateReadStatePatch(patch: MailReadStatePatch): MailReadStatePatch {
  if (
    patch.isRead === undefined &&
    patch.isImportantPersonal === undefined
  ) {
    throw MailReadApiError.validation(
      "At least one of isRead or isImportantPersonal is required",
    );
  }
  if (patch.isRead !== undefined && typeof patch.isRead !== "boolean") {
    throw MailReadApiError.validation("isRead must be a boolean");
  }
  if (
    patch.isImportantPersonal !== undefined &&
    typeof patch.isImportantPersonal !== "boolean"
  ) {
    throw MailReadApiError.validation("isImportantPersonal must be a boolean");
  }
  return patch;
}

export function appendFolderQuery(
  searchParams: URLSearchParams,
  folder: MailReadFolder | undefined,
): void {
  if (folder) {
    searchParams.set("folder", folder);
  }
}
