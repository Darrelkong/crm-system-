import PostalMime, { type Address, type Attachment, type Email } from "postal-mime";
import { normalizeDisplayName } from "@/lib/mail/canonical-content-hash-v1-contract";
import { MailServiceError } from "@/lib/mail/errors";
import { normalizeMailEmailAddress } from "@/lib/mail/normalize-email-address";
import {
  derivePlainTextFromSanitizedHtml,
  sanitizeInboundBodyHtml,
} from "@/lib/mail/inbound-body-html-sanitizer";

export type ParsedInboundRecipient = {
  recipientType: "to" | "cc" | "bcc";
  address: string;
  displayName: string | null;
  sortOrder: number;
};

export type ParsedInboundAttachment = {
  originalFilename: string;
  displayFilename: string;
  mimeType: string;
  sizeBytes: number;
  bytes: Uint8Array;
  sortOrder: number;
  disposition: "attachment" | "inline";
  contentId: string | null;
};

export type ParsedInboundMime = {
  fromAddress: string;
  fromDisplayName: string | null;
  subject: string;
  internetMessageId: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  bodyText: string;
  bodyHtmlSanitized: string | null;
  recipients: ParsedInboundRecipient[];
  attachments: ParsedInboundAttachment[];
};

function attachmentBytes(content: Attachment["content"]): Uint8Array {
  if (content instanceof Uint8Array) {
    return content;
  }
  if (content instanceof ArrayBuffer) {
    return new Uint8Array(content);
  }
  if (typeof content === "string") {
    return new TextEncoder().encode(content);
  }
  throw MailServiceError.integrityConflict("Unsupported attachment encoding");
}

function flattenAddresses(
  addresses: Address[] | undefined,
): Array<{ address: string; displayName: string | null }> {
  if (!addresses?.length) {
    return [];
  }
  const result: Array<{ address: string; displayName: string | null }> = [];
  for (const entry of addresses) {
    if ("group" in entry && entry.group) {
      for (const member of entry.group) {
        if (member.address) {
          result.push({
            address: member.address,
            displayName: member.name?.trim() || null,
          });
        }
      }
      continue;
    }
    if (entry.address) {
      result.push({
        address: entry.address,
        displayName: entry.name?.trim() || null,
      });
    }
  }
  return result;
}

function parseRecipientRows(
  type: ParsedInboundRecipient["recipientType"],
  addresses: Address[] | undefined,
  startOrder: number,
): ParsedInboundRecipient[] {
  const flattened = flattenAddresses(addresses);
  const seen = new Set<string>();
  const rows: ParsedInboundRecipient[] = [];
  let order = startOrder;
  for (const entry of flattened) {
    const normalized = normalizeMailEmailAddress(entry.address);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    rows.push({
      recipientType: type,
      address: normalized,
      displayName: entry.displayName
        ? normalizeDisplayName(entry.displayName)
        : null,
      sortOrder: order++,
    });
  }
  return rows;
}

/** Conservative RFC Message-ID normalization — NULL when unusable. */
export function normalizeInboundInternetMessageId(
  raw: string | null | undefined,
): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  const candidate = trimmed.startsWith("<") ? trimmed : `<${trimmed}>`;
  if (!/^<[^<>\s@]+@[^<>\s]+>$/.test(candidate)) {
    return null;
  }
  return candidate;
}

function resolveSender(email: Email): { address: string; displayName: string | null } {
  const source = email.from ?? email.sender;
  if (!source || "group" in source) {
    throw MailServiceError.integrityConflict("Inbound MIME missing usable From sender");
  }
  if (!source.address?.trim()) {
    throw MailServiceError.integrityConflict("Inbound MIME missing usable From sender");
  }
  return {
    address: normalizeMailEmailAddress(source.address),
    displayName: source.name?.trim()
      ? normalizeDisplayName(source.name.trim())
      : null,
  };
}

function safeFilename(raw: string | null | undefined, fallback: string): string {
  const trimmed = raw?.trim().replace(/[/\\]/g, "_").replace(/\0/g, "");
  if (!trimmed || trimmed === "." || trimmed === "..") {
    return fallback;
  }
  return trimmed.slice(0, 255);
}

function safeMimeType(raw: string | null | undefined): string {
  const trimmed = raw?.trim().toLowerCase() ?? "";
  if (!trimmed || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(trimmed)) {
    return "application/octet-stream";
  }
  return trimmed;
}

/**
 * Parses raw MIME bytes into canonical inbound candidate semantics.
 * Parser output is treated as untrusted data — HTML is sanitized before return.
 */
export async function parseInboundMimeBytes(
  bytes: Uint8Array,
): Promise<ParsedInboundMime> {
  let email: Email;
  try {
    email = await PostalMime.parse(bytes, {
      attachmentEncoding: "arraybuffer",
      maxNestingDepth: 32,
      maxHeadersSize: 256 * 1024,
    });
  } catch (error) {
    throw MailServiceError.integrityConflict("Inbound MIME parse failure", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const sender = resolveSender(email);
  const subject = email.subject?.trim() ?? "";
  const bodyHtmlSanitized = email.html
    ? sanitizeInboundBodyHtml(email.html)
    : null;
  const bodyText =
    email.text?.trim() ||
    (bodyHtmlSanitized ? derivePlainTextFromSanitizedHtml(bodyHtmlSanitized) : "");

  const recipients = [
    ...parseRecipientRows("to", email.to, 0),
    ...parseRecipientRows("cc", email.cc, 0),
    ...parseRecipientRows("bcc", email.bcc, 0),
  ].map((row, index) => ({ ...row, sortOrder: index }));

  const attachments: ParsedInboundAttachment[] = email.attachments.map(
    (attachment, index) => {
      const bytes = attachmentBytes(attachment.content);
      const filename = safeFilename(
        attachment.filename,
        `attachment-${index + 1}`,
      );
      return {
        originalFilename: filename,
        displayFilename: filename,
        mimeType: safeMimeType(attachment.mimeType),
        sizeBytes: bytes.byteLength,
        bytes,
        sortOrder: index,
        disposition:
          attachment.disposition === "inline" ? "inline" : "attachment",
        contentId: attachment.contentId?.trim() || null,
      };
    },
  );

  return {
    fromAddress: sender.address,
    fromDisplayName: sender.displayName,
    subject,
    internetMessageId: normalizeInboundInternetMessageId(email.messageId),
    inReplyTo: normalizeInboundInternetMessageId(email.inReplyTo),
    referencesHeader: email.references?.trim() || null,
    bodyText,
    bodyHtmlSanitized,
    recipients,
    attachments,
  };
}
