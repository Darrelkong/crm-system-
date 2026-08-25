import { MailServiceError } from "@/lib/mail/errors";
import {
  MAIL_READ_DEFAULT_LIMIT,
  MAIL_READ_MAX_LIMIT,
} from "@/lib/mail/mail-read-service";
import type { MailMessageReadFolder } from "@/lib/mail/message-read-permissions";
import type { MessageReadStatePatch } from "@/lib/mail/mail-read-state-service";

export const MAIL_READ_RESOURCE_ID_MAX_LENGTH = 191;

export function parseRequiredResourceId(
  value: unknown,
  fieldName: string,
): string {
  if (typeof value !== "string") {
    throw MailServiceError.validation(`${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw MailServiceError.validation(`${fieldName} is required`);
  }
  if (trimmed.length > MAIL_READ_RESOURCE_ID_MAX_LENGTH) {
    throw MailServiceError.validation(`${fieldName} is invalid`);
  }
  return trimmed;
}

export function parseRequiredMessageId(value: unknown): string {
  return parseRequiredResourceId(value, "messageId");
}

export function parseRequiredAttachmentId(value: unknown): string {
  return parseRequiredResourceId(value, "attachmentId");
}

export function parseRequiredThreadId(value: unknown): string {
  return parseRequiredResourceId(value, "threadId");
}

function readTrimmedParam(
  searchParams: URLSearchParams,
  key: string,
): string | undefined {
  const value = searchParams.get(key)?.trim();
  return value ? value : undefined;
}

export function parseRequiredMailboxId(searchParams: URLSearchParams): string {
  const mailboxId = readTrimmedParam(searchParams, "mailboxId");
  if (!mailboxId) {
    throw MailServiceError.validation("mailboxId is required");
  }
  return mailboxId;
}

function isMessageReadFolder(value: string): value is MailMessageReadFolder {
  return value === "inbox" || value === "sent" || value === "trash";
}

export function parseRequiredMessageListFolder(
  searchParams: URLSearchParams,
): MailMessageReadFolder {
  const folder = readTrimmedParam(searchParams, "folder");
  if (!folder) {
    throw MailServiceError.validation("folder is required");
  }
  if (!isMessageReadFolder(folder)) {
    throw MailServiceError.validation(
      "folder must be one of: inbox, sent, trash",
    );
  }
  return folder;
}

export function parseOptionalMessageReadFolder(
  searchParams: URLSearchParams,
): MailMessageReadFolder | undefined {
  const folder = readTrimmedParam(searchParams, "folder");
  if (!folder) {
    return undefined;
  }
  if (!isMessageReadFolder(folder)) {
    throw MailServiceError.validation(
      "folder must be one of: inbox, sent, trash",
    );
  }
  return folder;
}

export function parseOptionalMessageListLimit(
  searchParams: URLSearchParams,
): number | undefined {
  const raw = readTrimmedParam(searchParams, "limit");
  if (raw == null) {
    return undefined;
  }
  if (!/^\d+$/.test(raw)) {
    throw MailServiceError.validation("limit must be a positive integer");
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw MailServiceError.validation("limit must be a positive integer");
  }
  if (parsed > MAIL_READ_MAX_LIMIT) {
    throw MailServiceError.validation(
      `limit must not exceed ${MAIL_READ_MAX_LIMIT}`,
    );
  }
  return parsed;
}

export function parseOptionalCursor(
  searchParams: URLSearchParams,
): string | undefined {
  const cursor = readTrimmedParam(searchParams, "cursor");
  return cursor ?? undefined;
}

export function resolveMessageListLimit(
  limit: number | undefined,
): number {
  if (limit == null) {
    return MAIL_READ_DEFAULT_LIMIT;
  }
  return limit;
}

export function parseReadStatePatch(body: unknown): MessageReadStatePatch {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw MailServiceError.validation("Request body must be a JSON object");
  }

  const record = body as Record<string, unknown>;
  const patch: MessageReadStatePatch = {};

  if ("isRead" in record) {
    if (typeof record.isRead !== "boolean") {
      throw MailServiceError.validation("isRead must be a boolean");
    }
    patch.isRead = record.isRead;
  }

  if ("isImportantPersonal" in record) {
    if (typeof record.isImportantPersonal !== "boolean") {
      throw MailServiceError.validation("isImportantPersonal must be a boolean");
    }
    patch.isImportantPersonal = record.isImportantPersonal;
  }

  if (patch.isRead === undefined && patch.isImportantPersonal === undefined) {
    throw MailServiceError.validation(
      "At least one of isRead or isImportantPersonal is required",
    );
  }

  const unknownKeys = Object.keys(record).filter(
    (key) => key !== "isRead" && key !== "isImportantPersonal",
  );
  if (unknownKeys.length > 0) {
    throw MailServiceError.validation(
      `Unknown fields: ${unknownKeys.join(", ")}`,
    );
  }

  return patch;
}
