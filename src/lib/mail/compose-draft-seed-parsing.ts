import type { MailComposeMode } from "../../../drizzle/schema/mail-drafts";
import { MailServiceError } from "@/lib/mail/errors";
import type { MailMessageReadFolder } from "@/lib/mail/message-read-permissions";

export const COMPOSE_DRAFT_SEED_MODES = [
  "reply",
  "reply_all",
  "forward",
] as const;

export type ComposeDraftSeedMode = (typeof COMPOSE_DRAFT_SEED_MODES)[number];

export function isComposeDraftSeedMode(
  value: string,
): value is ComposeDraftSeedMode {
  return (COMPOSE_DRAFT_SEED_MODES as readonly string[]).includes(value);
}

export type ComposeDraftSeedRequest = {
  mode: ComposeDraftSeedMode;
  folder?: MailMessageReadFolder;
};

export function parseComposeDraftSeedRequest(body: unknown): ComposeDraftSeedRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw MailServiceError.validation("Request body must be a JSON object");
  }

  const record = body as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter(
    (key) => key !== "mode" && key !== "folder",
  );
  if (unknownKeys.length > 0) {
    throw MailServiceError.validation(
      `Unknown fields: ${unknownKeys.join(", ")}`,
    );
  }

  const mode = record.mode;
  if (typeof mode !== "string" || !isComposeDraftSeedMode(mode)) {
    throw MailServiceError.validation(
      'mode must be one of: reply, reply_all, forward',
    );
  }

  const folderValue = record.folder;
  if (folderValue === undefined) {
    return { mode };
  }
  if (typeof folderValue !== "string") {
    throw MailServiceError.validation("folder must be a string");
  }
  if (
    folderValue !== "inbox" &&
    folderValue !== "sent" &&
    folderValue !== "trash"
  ) {
    throw MailServiceError.validation(
      "folder must be one of: inbox, sent, trash",
    );
  }

  return { mode, folder: folderValue };
}

export function assertSeededComposeMode(
  mode: MailComposeMode,
): asserts mode is Exclude<MailComposeMode, "new"> {
  if (mode === "new") {
    throw MailServiceError.validation("Seed service does not support new mode");
  }
}
