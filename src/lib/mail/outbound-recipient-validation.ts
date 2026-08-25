import type { MailRecipientType } from "../../../drizzle/schema/mail-message-recipients";
import { MailServiceError } from "@/lib/mail/errors";
import { normalizeMailEmailAddress } from "@/lib/mail/normalize-email-address";

export const MAX_OUTBOUND_RECIPIENTS = 50;

export type OutboundRecipientInput = {
  recipientType: MailRecipientType;
  address: string;
  displayName?: string | null;
  sortOrder?: number;
};

export type NormalizedOutboundRecipient = {
  recipientType: MailRecipientType;
  address: string;
  displayName: string | null;
  sortOrder: number;
};

export function normalizeOutboundRecipientAddress(address: string): string {
  try {
    return normalizeMailEmailAddress(address);
  } catch {
    throw MailServiceError.validation("Invalid recipient address");
  }
}

export function normalizeOutboundRecipients(
  recipients: OutboundRecipientInput[],
  options?: { allowEmpty?: boolean },
): NormalizedOutboundRecipient[] {
  const seen = new Set<string>();
  const normalized: NormalizedOutboundRecipient[] = [];

  for (const [index, recipient] of recipients.entries()) {
    if (
      recipient.recipientType !== "to" &&
      recipient.recipientType !== "cc" &&
      recipient.recipientType !== "bcc"
    ) {
      throw MailServiceError.validation("Invalid recipient type");
    }
    const address = normalizeOutboundRecipientAddress(recipient.address);
    if (seen.has(address)) {
      throw MailServiceError.validation(
        "Duplicate recipient address across To/Cc/Bcc",
      );
    }
    seen.add(address);
    normalized.push({
      recipientType: recipient.recipientType,
      address,
      displayName: recipient.displayName?.normalize("NFC") ?? null,
      sortOrder: recipient.sortOrder ?? index,
    });
  }

  if (normalized.length === 0 && !options?.allowEmpty) {
    throw MailServiceError.validation("At least one recipient is required");
  }
  if (normalized.length > MAX_OUTBOUND_RECIPIENTS) {
    throw MailServiceError.validation(
      `Maximum ${MAX_OUTBOUND_RECIPIENTS} unique recipients allowed`,
    );
  }

  return normalized;
}

export function assertRevisionSubject(subject: string): string {
  if (!subject || subject.trim().length === 0) {
    throw MailServiceError.validation("Subject is required for revision creation");
  }
  return subject.normalize("NFC");
}
