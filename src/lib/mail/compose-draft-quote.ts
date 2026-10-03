import type { MailMessage } from "../../../drizzle/schema/mail-messages";
import { derivePlainTextFromSanitizedHtml } from "@/lib/mail/inbound-body-html-sanitizer";
import { sanitizeQuoteHtml } from "@/lib/mail/compose-body-html";
import { formatHongKongDateTime } from "@/lib/timezone";
import type { VisibleSourceRecipient } from "@/lib/mail/compose-draft-recipient-derivation";

export type SourceQuoteBody = {
  bodyText: string;
  bodyHtmlSanitized: string | null;
  quotedText: string | null;
  quotedHtmlSanitized: string | null;
};

export type SeededDraftBody = {
  bodyText: string;
  bodyHtml: string | null;
};

function formatSenderLabel(
  fromAddress: string,
  fromDisplayName: string | null,
): string {
  const name = fromDisplayName?.trim();
  if (name) {
    return `${name} <${fromAddress}>`;
  }
  return fromAddress;
}

function resolveSafeSourceText(source: SourceQuoteBody): string {
  const body = source.bodyText.trim() || derivePlainTextFromSanitizedHtml(
    sanitizeQuoteHtml(source.bodyHtmlSanitized ?? "", true) ?? "",
  );
  const history = source.quotedText?.trim() || derivePlainTextFromSanitizedHtml(
    sanitizeQuoteHtml(source.quotedHtmlSanitized ?? "", true) ?? "",
  );
  return [body, history].filter(Boolean).join("\n\n");
}

function resolveSafeSourceHtml(source: SourceQuoteBody): string | null {
  const body = sanitizeQuoteHtml(source.bodyHtmlSanitized ?? "")
    || (source.bodyText.trim() ? `<pre>${escapeHtml(source.bodyText)}</pre>` : "");
  const history = sanitizeQuoteHtml(source.quotedHtmlSanitized ?? "")
    || (source.quotedText?.trim() ? `<pre>${escapeHtml(source.quotedText)}</pre>` : "");
  return [body, history ? `<blockquote>${history}</blockquote>` : ""].join("") || null;
}

function formatRecipientList(recipients: VisibleSourceRecipient[]): string {
  return recipients
    .filter(
      (recipient) =>
        recipient.recipientType === "to" || recipient.recipientType === "cc",
    )
    .map((recipient) => {
      const name = recipient.displayName?.trim();
      return name ? `${name} <${recipient.address}>` : recipient.address;
    })
    .join(", ");
}

function formatTimestamp(
  message: Pick<MailMessage, "direction" | "receivedAt" | "sentAt">,
): string {
  const raw =
    message.direction === "inbound"
      ? message.receivedAt
      : message.sentAt ?? message.receivedAt;
  return formatHongKongDateTime(raw);
}

export function buildReplyQuoteBody(input: {
  message: Pick<
    MailMessage,
    "fromAddress" | "fromDisplayName" | "direction" | "receivedAt" | "sentAt"
  >;
  source: SourceQuoteBody;
}): SeededDraftBody {
  const sender = formatSenderLabel(
    input.message.fromAddress,
    input.message.fromDisplayName,
  );
  const timestamp = formatTimestamp(input.message);
  const sourceText = resolveSafeSourceText(input.source);
  const sourceHtml = resolveSafeSourceHtml(input.source);

  const bodyText = [
    "",
    `On ${timestamp}, ${sender} wrote:`,
    sourceText,
  ]
    .filter(Boolean)
    .join("\n\n");

  const bodyHtml = sourceHtml
    ? `<p></p><p>On ${escapeHtml(timestamp)}, ${escapeHtml(sender)} wrote:</p><blockquote>${sourceHtml}</blockquote>`
    : `<p></p><p>On ${escapeHtml(timestamp)}, ${escapeHtml(sender)} wrote:</p><pre>${escapeHtml(sourceText)}</pre>`;

  return {
    bodyText,
    bodyHtml: sanitizeQuoteHtml(bodyHtml),
  };
}

export function buildForwardQuoteBody(input: {
  message: Pick<
    MailMessage,
    | "fromAddress"
    | "fromDisplayName"
    | "subject"
    | "direction"
    | "receivedAt"
    | "sentAt"
  >;
  visibleRecipients: VisibleSourceRecipient[];
  source: SourceQuoteBody;
}): SeededDraftBody {
  const sender = formatSenderLabel(
    input.message.fromAddress,
    input.message.fromDisplayName,
  );
  const timestamp = formatTimestamp(input.message);
  const toLine = formatRecipientList(
    input.visibleRecipients.filter((recipient) => recipient.recipientType === "to"),
  );
  const ccLine = formatRecipientList(
    input.visibleRecipients.filter((recipient) => recipient.recipientType === "cc"),
  );
  const sourceText = resolveSafeSourceText(input.source);
  const sourceHtml = resolveSafeSourceHtml(input.source);

  const headerLines = [
    "---------- Forwarded message ----------",
    `From: ${sender}`,
    `Date: ${timestamp}`,
    `Subject: ${input.message.subject}`,
    `To: ${toLine || "—"}`,
  ];
  if (ccLine) {
    headerLines.push(`Cc: ${ccLine}`);
  }

  const bodyText = ["", ...headerLines, "", sourceText].join("\n");

  const headerHtml = headerLines
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
  const bodyHtml = sourceHtml
    ? `<p></p>${headerHtml}<blockquote>${sourceHtml}</blockquote>`
    : `<p></p>${headerHtml}<pre>${escapeHtml(sourceText)}</pre>`;

  return {
    bodyText,
    bodyHtml: sanitizeQuoteHtml(bodyHtml),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
