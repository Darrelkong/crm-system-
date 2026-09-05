import {
  MailReadApiError,
  normalizeMailReadApiError,
} from "@/lib/mail/client/mail-read-api-errors";
import type { MailboxScope } from "@/lib/mail/client/mail-read-types";

export type MailOutboxStatus =
  | "pending"
  | "processing"
  | "failed"
  | "dispatch_uncertain";

export type MailOutboxListItem = {
  sendOperationId: string;
  outboundRevisionId: string;
  mailboxId: string;
  authorizationMode: "admin_direct" | "staff_approved";
  status: MailOutboxStatus;
  subject: string;
  from: {
    address: string;
    displayName: string | null;
  };
  recipients: Array<{
    address: string;
    displayName: string | null;
    recipientType: string;
  }>;
  totalRecipientCount: number;
  createdAt: string;
  completedAt: string | null;
  nextAttemptAt: string | null;
  attachmentCount: number;
  hasAttachments: boolean;
  failureCode: "send_failed" | "dispatch_uncertain" | null;
  sourceMailbox?: {
    address: string;
    displayName: string | null;
    mailboxType: "personal" | "shared";
  };
};

export type MailOutboxListPage = {
  items: MailOutboxListItem[];
  nextCursor: string | null;
};

export const OUTBOX_PATH = "/api/mail/send-operations";

export function buildOutboxPath(mailboxId?: string | null): string {
  if (!mailboxId) {
    return OUTBOX_PATH;
  }
  return `${OUTBOX_PATH}?mailboxId=${encodeURIComponent(mailboxId)}`;
}

export function buildOutboxPagePath(input: {
  scope: MailboxScope;
  mailboxId?: string | null;
  cursor?: string | null;
  limit?: number;
  search?: string | null;
}): string {
  const params = new URLSearchParams({ scope: input.scope });
  if (input.mailboxId) params.set("mailboxId", input.mailboxId);
  if (input.cursor) params.set("cursor", input.cursor);
  if (input.limit != null) params.set("limit", String(input.limit));
  if (input.search?.trim()) params.set("q", input.search.trim());
  return `${OUTBOX_PATH}?${params.toString()}`;
}

export function resolveOutboxStatusLabelKey(
  status: MailOutboxStatus,
): string {
  switch (status) {
    case "pending":
      return "mail.outbox.waiting";
    case "processing":
      return "mail.outbox.sending";
    case "failed":
      return "mail.outbox.failed";
    case "dispatch_uncertain":
      return "mail.outbox.uncertain";
  }
}

export function mapOutboxItemsResponse(body: {
  items?: MailOutboxListItem[];
}): MailOutboxListItem[] {
  if (!Array.isArray(body.items)) {
    throw MailReadApiError.validation("Invalid outbox response");
  }
  return body.items;
}

export async function fetchOutboxItems(
  mailboxId?: string | null,
): Promise<MailOutboxListItem[]> {
  const response = await fetch(buildOutboxPath(mailboxId), {
    cache: "no-store",
  });
  if (!response.ok) {
    throw await normalizeMailReadApiError(
      response,
      "Failed to load outbox",
    );
  }
  return mapOutboxItemsResponse(
    (await response.json()) as { items?: MailOutboxListItem[] },
  );
}

export async function fetchOutboxPage(input: {
  scope: MailboxScope;
  mailboxId?: string | null;
  cursor?: string | null;
  limit?: number;
  search?: string | null;
}): Promise<MailOutboxListPage> {
  const response = await fetch(buildOutboxPagePath(input), {
    cache: "no-store",
  });
  if (!response.ok) {
    throw await normalizeMailReadApiError(
      response,
      "Failed to load outbox page",
    );
  }
  const body = (await response.json()) as Partial<MailOutboxListPage>;
  return {
    items: mapOutboxItemsResponse(body),
    nextCursor: body.nextCursor ?? null,
  };
}
