import {
  MailReadApiError,
  normalizeMailReadApiError,
} from "@/lib/mail/client/mail-read-api-errors";

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
};

export const OUTBOX_PATH = "/api/mail/send-operations";

export function buildOutboxPath(mailboxId?: string | null): string {
  if (!mailboxId) {
    return OUTBOX_PATH;
  }
  return `${OUTBOX_PATH}?mailboxId=${encodeURIComponent(mailboxId)}`;
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
