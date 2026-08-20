import {
  normalizeDisplayName,
  normalizeEmailAddress,
  normalizeSubject,
} from "@/lib/mail/canonical-content-hash-v1-contract";
import { MailServiceError } from "@/lib/mail/errors";
import type { ParsedInboundMime } from "@/lib/mail/inbound-mime-parser";

export type InboundAttachmentSemantic = {
  contentHash: string;
  sizeBytes: number;
  mimeType: string;
  originalFilename: string;
  displayFilename: string;
  sortOrder: number;
};

export type InboundCanonicalSemanticGraph = {
  direction: "inbound";
  fromAddress: string;
  fromDisplayName: string | null;
  subject: string;
  subjectNormalized: string;
  previewText: string;
  internetMessageId: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  bodyText: string;
  bodyHtmlSanitized: string | null;
  recipients: Array<{
    recipientType: "to" | "cc" | "bcc";
    address: string;
    displayName: string | null;
    sortOrder: number;
  }>;
  attachments: InboundAttachmentSemantic[];
};

function buildPreviewText(bodyText: string, subject: string): string {
  const source = bodyText.trim() || subject.trim();
  if (source.length <= 200) {
    return source;
  }
  return `${source.slice(0, 197)}...`;
}

export function inboundSemanticGraphFromParsedMime(
  parsed: ParsedInboundMime,
  attachmentSemantics: InboundAttachmentSemantic[],
): InboundCanonicalSemanticGraph {
  return {
    direction: "inbound",
    fromAddress: parsed.fromAddress,
    fromDisplayName: parsed.fromDisplayName,
    subject: parsed.subject,
    subjectNormalized: normalizeSubject(parsed.subject),
    previewText: buildPreviewText(parsed.bodyText, parsed.subject),
    internetMessageId: parsed.internetMessageId,
    inReplyTo: parsed.inReplyTo,
    referencesHeader: parsed.referencesHeader,
    bodyText: parsed.bodyText,
    bodyHtmlSanitized: parsed.bodyHtmlSanitized,
    recipients: parsed.recipients.map((row) => ({
      recipientType: row.recipientType,
      address: row.address,
      displayName: row.displayName,
      sortOrder: row.sortOrder,
    })),
    attachments: attachmentSemantics,
  };
}

function recipientKey(row: {
  recipientType: string;
  address: string;
  displayName: string | null;
}): string {
  return [
    row.recipientType,
    normalizeEmailAddress(row.address),
    normalizeDisplayName(row.displayName),
  ].join("\0");
}

function attachmentKey(row: InboundAttachmentSemantic): string {
  return [
    row.contentHash,
    String(row.sizeBytes),
    row.mimeType,
    row.originalFilename,
    row.displayFilename,
    String(row.sortOrder),
  ].join("\0");
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Deterministic semantic equality for RFC Message-ID collision checks.
 * Compares every meaningful canonical field that would be persisted.
 */
export function inboundCanonicalSemanticGraphsEqual(
  left: InboundCanonicalSemanticGraph,
  right: InboundCanonicalSemanticGraph,
): boolean {
  if (left.direction !== right.direction) return false;
  if (normalizeEmailAddress(left.fromAddress) !== normalizeEmailAddress(right.fromAddress)) {
    return false;
  }
  if (
    normalizeDisplayName(left.fromDisplayName) !==
    normalizeDisplayName(right.fromDisplayName)
  ) {
    return false;
  }
  if (left.subject !== right.subject) return false;
  if (left.subjectNormalized !== right.subjectNormalized) return false;
  if (left.previewText !== right.previewText) return false;
  if (left.internetMessageId !== right.internetMessageId) return false;
  if (left.inReplyTo !== right.inReplyTo) return false;
  if (left.referencesHeader !== right.referencesHeader) return false;
  if (left.bodyText !== right.bodyText) return false;
  if (left.bodyHtmlSanitized !== right.bodyHtmlSanitized) return false;

  if (left.recipients.length !== right.recipients.length) return false;
  const leftRecipients = [...left.recipients].sort((a, b) =>
    recipientKey(a).localeCompare(recipientKey(b)),
  );
  const rightRecipients = [...right.recipients].sort((a, b) =>
    recipientKey(a).localeCompare(recipientKey(b)),
  );
  for (let i = 0; i < leftRecipients.length; i++) {
    const l = leftRecipients[i];
    const r = rightRecipients[i];
    if (
      l.recipientType !== r.recipientType ||
      normalizeEmailAddress(l.address) !== normalizeEmailAddress(r.address) ||
      normalizeDisplayName(l.displayName) !== normalizeDisplayName(r.displayName) ||
      l.sortOrder !== r.sortOrder
    ) {
      return false;
    }
  }

  if (left.attachments.length !== right.attachments.length) return false;
  const leftAttachments = [...left.attachments].sort((a, b) =>
    attachmentKey(a).localeCompare(attachmentKey(b)),
  );
  const rightAttachments = [...right.attachments].sort((a, b) =>
    attachmentKey(a).localeCompare(attachmentKey(b)),
  );
  for (let i = 0; i < leftAttachments.length; i++) {
    const l = leftAttachments[i];
    const r = rightAttachments[i];
    if (attachmentKey(l) !== attachmentKey(r)) {
      return false;
    }
  }

  return true;
}

export function assertInboundCanonicalSemanticGraphsEqual(
  left: InboundCanonicalSemanticGraph,
  right: InboundCanonicalSemanticGraph,
): void {
  if (!inboundCanonicalSemanticGraphsEqual(left, right)) {
    throw MailServiceError.integrityConflict(
      "RFC Message-ID collision with differing canonical semantics",
      {
        left: stableJson(left),
        right: stableJson(right),
      },
    );
  }
}
