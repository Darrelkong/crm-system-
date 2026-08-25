import type { OutboundRecipientInput } from "@/lib/mail/outbound-recipient-validation";

export { parseDraftCustomerAssociationPatch } from "@/lib/mail/mail-customer-association-service";

export function parseDraftRecipientsField(
  value: unknown,
): OutboundRecipientInput[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const recipients: OutboundRecipientInput[] = [];
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const recipientType = record.recipientType;
    const address = record.address;
    if (
      (recipientType !== "to" &&
        recipientType !== "cc" &&
        recipientType !== "bcc") ||
      typeof address !== "string"
    ) {
      continue;
    }
    recipients.push({
      recipientType,
      address,
      displayName:
        typeof record.displayName === "string" ? record.displayName : undefined,
      sortOrder: typeof record.sortOrder === "number" ? record.sortOrder : index,
    });
  }

  return recipients;
}
