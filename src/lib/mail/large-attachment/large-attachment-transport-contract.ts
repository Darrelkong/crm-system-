import type { MailDeliveryMode } from "../../../../drizzle/schema/mail-draft-attachments";
import { sumDirectAttachmentRawBytes } from "@/lib/mail/outbound-provider-size-preflight";

export function isDirectMimeAttachmentDeliveryMode(
  deliveryMode: MailDeliveryMode | string,
): deliveryMode is "direct_attachment" {
  return deliveryMode === "direct_attachment";
}

export function filterDirectMimeAttachments<
  T extends { deliveryMode: MailDeliveryMode | string; sizeBytes: number },
>(attachments: T[]): T[] {
  return attachments.filter((attachment) =>
    isDirectMimeAttachmentDeliveryMode(attachment.deliveryMode),
  );
}

export function sumDirectMimeAttachmentBytes(
  attachments: Array<{ deliveryMode: MailDeliveryMode | string; sizeBytes: number }>,
): number {
  return sumDirectAttachmentRawBytes(attachments);
}

export function assertLargeAttachmentsExcludedFromDirectMime<T extends { deliveryMode: MailDeliveryMode | string }>(
  attachments: T[],
): void {
  for (const attachment of attachments) {
    if (attachment.deliveryMode === "large_attachment") {
      throw new Error(
        "Large attachments must not enter direct MIME byte aggregation",
      );
    }
  }
}

export type LargeAttachmentSentMetadataView = {
  deliveryMode: "large_attachment";
  displayFilename: string;
  sizeBytes: number;
  sentAt: string | null;
  recipientExpiresAt: string | null;
  lifecycleStatus: string;
  expired: boolean;
};

export function toLargeAttachmentSentMetadataView(input: {
  displayFilename: string;
  sizeBytes: number;
  sentAt: string | null;
  recipientExpiresAt: string | null;
  lifecycleStatus: string;
  trustNowIso: string;
}): LargeAttachmentSentMetadataView {
  const expired =
    input.lifecycleStatus === "expired" ||
    (input.recipientExpiresAt !== null &&
      Date.parse(input.recipientExpiresAt) <= Date.parse(input.trustNowIso));
  return {
    deliveryMode: "large_attachment",
    displayFilename: input.displayFilename,
    sizeBytes: input.sizeBytes,
    sentAt: input.sentAt,
    recipientExpiresAt: input.recipientExpiresAt,
    lifecycleStatus: input.lifecycleStatus,
    expired,
  };
}
