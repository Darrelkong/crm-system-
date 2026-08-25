import type { MailComposeMode } from "../../../drizzle/schema/mail-drafts";
import type { MailMessage } from "../../../drizzle/schema/mail-messages";
import type { MailRecipientType } from "../../../drizzle/schema/mail-message-recipients";
import type { OutboundRecipientInput } from "@/lib/mail/outbound-recipient-validation";
import { tryNormalizeMailEmailAddress } from "@/lib/mail/normalize-email-address";

export type VisibleSourceRecipient = {
  recipientType: MailRecipientType;
  address: string;
  displayName: string | null;
  sortOrder?: number;
};

export type DerivedSeedRecipients = {
  recipients: OutboundRecipientInput[];
  /** Normalized addresses excluded from derivation (self / invalid). */
  excludedNormalized: Set<string>;
};

function normalizeOptionalAddress(address: string): string | null {
  const result = tryNormalizeMailEmailAddress(address);
  return result.ok ? result.address : null;
}

function buildRecipientInput(
  recipientType: MailRecipientType,
  address: string,
  displayName: string | null,
  sortOrder: number,
): OutboundRecipientInput {
  return {
    recipientType,
    address,
    displayName,
    sortOrder,
  };
}

function visibleToAndCc(recipients: VisibleSourceRecipient[]): VisibleSourceRecipient[] {
  return recipients.filter(
    (recipient) =>
      recipient.recipientType === "to" || recipient.recipientType === "cc",
  );
}

function partitionByType(recipients: VisibleSourceRecipient[]) {
  const to: VisibleSourceRecipient[] = [];
  const cc: VisibleSourceRecipient[] = [];
  for (const recipient of recipients) {
    if (recipient.recipientType === "to") {
      to.push(recipient);
    } else if (recipient.recipientType === "cc") {
      cc.push(recipient);
    }
  }
  return { to, cc };
}

function addUniqueRecipient(
  bucket: OutboundRecipientInput[],
  seen: Set<string>,
  recipientType: MailRecipientType,
  rawAddress: string,
  displayName: string | null,
): void {
  const normalized = normalizeOptionalAddress(rawAddress);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  bucket.push(
    buildRecipientInput(
      recipientType,
      normalized,
      displayName,
      bucket.length,
    ),
  );
}

function excludeSelfAddresses(
  selfNormalized: Set<string>,
): (address: string) => boolean {
  return (address) => {
    const normalized = normalizeOptionalAddress(address);
    return normalized != null && !selfNormalized.has(normalized);
  };
}

/**
 * Derives seeded Draft recipients for reply / reply_all / forward.
 * Never includes historical Bcc. Uses only viewer-visible To/Cc rows.
 */
export function deriveSeedRecipients(input: {
  mode: MailComposeMode;
  message: Pick<MailMessage, "direction" | "fromAddress">;
  visibleRecipients: VisibleSourceRecipient[];
  selfAddresses: string[];
}): DerivedSeedRecipients {
  const selfNormalized = new Set<string>();
  for (const address of input.selfAddresses) {
    const normalized = normalizeOptionalAddress(address);
    if (normalized) {
      selfNormalized.add(normalized);
    }
  }

  if (input.mode === "forward") {
    return { recipients: [], excludedNormalized: selfNormalized };
  }

  const visible = visibleToAndCc(input.visibleRecipients);
  const { to: sourceTo, cc: sourceCc } = partitionByType(visible);
  const isSelfExcluded = excludeSelfAddresses(selfNormalized);
  const derived: OutboundRecipientInput[] = [];
  const seen = new Set<string>();

  if (input.mode === "reply") {
    if (input.message.direction === "inbound") {
      if (isSelfExcluded(input.message.fromAddress)) {
        addUniqueRecipient(
          derived,
          seen,
          "to",
          input.message.fromAddress,
          null,
        );
      }
    } else {
      for (const recipient of sourceTo) {
        if (isSelfExcluded(recipient.address)) {
          addUniqueRecipient(
            derived,
            seen,
            "to",
            recipient.address,
            recipient.displayName,
          );
        }
      }
      if (derived.length === 0) {
        for (const recipient of sourceCc) {
          if (isSelfExcluded(recipient.address)) {
            addUniqueRecipient(
              derived,
              seen,
              "to",
              recipient.address,
              recipient.displayName,
            );
          }
        }
      }
    }
    return { recipients: derived, excludedNormalized: selfNormalized };
  }

  // reply_all — Bcc is always empty by product rule.
  if (input.message.direction === "inbound") {
    if (isSelfExcluded(input.message.fromAddress)) {
      addUniqueRecipient(
        derived,
        seen,
        "to",
        input.message.fromAddress,
        null,
      );
    }
    for (const recipient of sourceTo) {
      if (isSelfExcluded(recipient.address)) {
        addUniqueRecipient(
          derived,
          seen,
          "to",
          recipient.address,
          recipient.displayName,
        );
      }
    }
    for (const recipient of sourceCc) {
      const normalized = normalizeOptionalAddress(recipient.address);
      if (!normalized || selfNormalized.has(normalized) || seen.has(normalized)) {
        continue;
      }
      addUniqueRecipient(
        derived,
        seen,
        "cc",
        recipient.address,
        recipient.displayName,
      );
    }
  } else {
    for (const recipient of sourceTo) {
      if (isSelfExcluded(recipient.address)) {
        addUniqueRecipient(
          derived,
          seen,
          "to",
          recipient.address,
          recipient.displayName,
        );
      }
    }
    for (const recipient of sourceCc) {
      const normalized = normalizeOptionalAddress(recipient.address);
      if (!normalized || selfNormalized.has(normalized) || seen.has(normalized)) {
        continue;
      }
      addUniqueRecipient(
        derived,
        seen,
        "cc",
        recipient.address,
        recipient.displayName,
      );
    }
  }

  return { recipients: derived, excludedNormalized: selfNormalized };
}
