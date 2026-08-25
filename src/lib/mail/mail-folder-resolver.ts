import type { SQL } from "drizzle-orm";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { schema } from "@/lib/db";
import { MailServiceError } from "@/lib/mail/errors";
import type { MailMessageReadFolder } from "@/lib/mail/message-read-permissions";

/** Folders backed by mail_messages queries. */
export type MailMessageListFolder = MailMessageReadFolder;

/**
 * Full workspace folder set including workflow folders handled by other services.
 * Drafts → draft service. Waiting approval → approval service.
 */
export type MailWorkspaceFolder =
  | MailMessageListFolder
  | "drafts"
  | "waiting_approval";

export type MessageFolderOrderColumn = "receivedAt" | "sentAt" | "trashedAt";

export type MessageFolderQuerySpec = {
  folder: MailMessageListFolder;
  direction: "inbound" | "outbound" | null;
  trashedOnly: boolean;
  orderColumn: MessageFolderOrderColumn;
};

const DRAFTS_FOLDER_MESSAGE =
  "Drafts folder is served by the draft service, not mail_messages";
const WAITING_APPROVAL_FOLDER_MESSAGE =
  "Waiting approval folder is served by the approval service, not mail_messages";

export function isMailMessageListFolder(
  folder: MailWorkspaceFolder,
): folder is MailMessageListFolder {
  return folder === "inbox" || folder === "sent" || folder === "trash";
}

/**
 * Resolves a workspace folder to a mail_messages query spec.
 * Throws for workflow folders that do not query mail_messages.
 */
export function resolveMessageFolderQuery(
  folder: MailWorkspaceFolder,
): MessageFolderQuerySpec {
  if (folder === "drafts") {
    throw MailServiceError.validation(DRAFTS_FOLDER_MESSAGE);
  }
  if (folder === "waiting_approval") {
    throw MailServiceError.validation(WAITING_APPROVAL_FOLDER_MESSAGE);
  }

  switch (folder) {
    case "inbox":
      return {
        folder: "inbox",
        direction: "inbound",
        trashedOnly: false,
        orderColumn: "receivedAt",
      };
    case "sent":
      return {
        folder: "sent",
        direction: "outbound",
        trashedOnly: false,
        orderColumn: "sentAt",
      };
    case "trash":
      return {
        folder: "trash",
        direction: null,
        trashedOnly: true,
        orderColumn: "trashedAt",
      };
    default: {
      const _exhaustive: never = folder;
      throw MailServiceError.validation(`Unsupported folder: ${_exhaustive}`);
    }
  }
}

export function buildMessageFolderConditions(
  mailboxId: string,
  spec: MessageFolderQuerySpec,
): SQL[] {
  const conditions: SQL[] = [eq(schema.mailMessages.mailboxId, mailboxId)];

  if (spec.trashedOnly) {
    conditions.push(isNotNull(schema.mailMessages.trashedAt));
  } else {
    conditions.push(isNull(schema.mailMessages.trashedAt));
  }

  if (spec.direction) {
    conditions.push(eq(schema.mailMessages.direction, spec.direction));
  }

  return conditions;
}

export function messageSortTimestamp(
  message: {
    direction: "inbound" | "outbound";
    receivedAt: string | null;
    sentAt: string | null;
    trashedAt: string | null;
  },
  orderColumn: MessageFolderOrderColumn,
): string {
  if (orderColumn === "trashedAt") {
    return message.trashedAt ?? message.receivedAt ?? message.sentAt ?? "";
  }
  if (orderColumn === "sentAt") {
    return message.sentAt ?? message.receivedAt ?? "";
  }
  return message.receivedAt ?? message.sentAt ?? "";
}
