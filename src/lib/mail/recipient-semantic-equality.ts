import {
  normalizeDisplayName,
  normalizeEmailAddress,
} from "@/lib/mail/canonical-content-hash-v1-contract";
import { MailServiceError } from "@/lib/mail/errors";

export type RecipientSemanticRow = {
  recipientType: "to" | "cc" | "bcc";
  address: string;
  displayName: string | null;
  sortOrder: number;
};

function semanticKey(row: RecipientSemanticRow): string {
  return [
    row.recipientType,
    normalizeEmailAddress(row.address),
    normalizeDisplayName(row.displayName),
  ].join("\0");
}

/**
 * Verifies complete recipient semantic set equality between revision and message rows.
 * Compares type, normalized address, display name, count, and sort order per address.
 */
export function assertRecipientSemanticSetsEqual(
  revisionRecipients: RecipientSemanticRow[],
  messageRecipients: RecipientSemanticRow[],
): void {
  if (revisionRecipients.length !== messageRecipients.length) {
    throw MailServiceError.integrityConflict(
      "Materialized recipient count does not match revision",
      {
        revisionCount: revisionRecipients.length,
        messageCount: messageRecipients.length,
      },
    );
  }

  const revisionByAddress = new Map(
    revisionRecipients.map((row) => [
      normalizeEmailAddress(row.address),
      row,
    ]),
  );
  const messageByAddress = new Map(
    messageRecipients.map((row) => [
      normalizeEmailAddress(row.address),
      row,
    ]),
  );

  if (revisionByAddress.size !== messageByAddress.size) {
    throw MailServiceError.integrityConflict(
      "Materialized recipient address set does not match revision",
    );
  }

  for (const [address, revisionRow] of revisionByAddress) {
    const messageRow = messageByAddress.get(address);
    if (!messageRow) {
      throw MailServiceError.integrityConflict(
        "Materialized recipient missing from revision set",
        { address },
      );
    }
    if (revisionRow.recipientType !== messageRow.recipientType) {
      throw MailServiceError.integrityConflict(
        "Materialized recipient type mismatch",
        { address },
      );
    }
    if (
      normalizeDisplayName(revisionRow.displayName) !==
      normalizeDisplayName(messageRow.displayName)
    ) {
      throw MailServiceError.integrityConflict(
        "Materialized recipient display name mismatch",
        { address },
      );
    }
    if (revisionRow.sortOrder !== messageRow.sortOrder) {
      throw MailServiceError.integrityConflict(
        "Materialized recipient sort order mismatch",
        { address },
      );
    }
  }
}
