import type { MailOutboundRevisionAttachment } from "../../../../drizzle/schema/mail-outbound-revision-attachments";

export type LargeAttachmentRecipientCard = {
  attachmentId: string;
  filename: string;
  sizeBytes: number;
  downloadUrl: string;
  recipientExpiresAt: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatSize(sizeBytes: number): string {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (sizeBytes >= 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  }
  return `${sizeBytes} B`;
}

function formatExpiry(): string {
  return "7 days after successful delivery";
}

export function renderLargeAttachmentRecipientHtml(
  cards: LargeAttachmentRecipientCard[],
): string {
  if (cards.length === 0) {
    return "";
  }

  const rows = cards
    .map(
      (card) => `
        <div style="border:1px solid #d1d5db;border-radius:8px;padding:12px;margin:12px 0;font-family:Arial,sans-serif;line-height:1.45;">
          <div style="font-weight:700;margin-bottom:6px;">📎 大附件</div>
          <div>${escapeHtml(card.filename)}</div>
          <div style="color:#4b5563;font-size:13px;">${formatSize(card.sizeBytes)}</div>
          <div style="margin-top:10px;"><a href="${escapeHtml(card.downloadUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;padding:8px 12px;">下载附件</a></div>
          <div style="color:#4b5563;font-size:12px;margin-top:8px;">该文件未进行自动安全扫描，请确认文件来源可信后再下载或打开。</div>
          <div style="color:#4b5563;font-size:12px;margin-top:4px;">下载链接有效期：${escapeHtml(formatExpiry())}</div>
          <div style="color:#6b7280;font-size:12px;margin-top:8px;">Large attachment. This file was not automatically scanned. Download or open it only if you trust the sender or source.</div>
        </div>`,
    )
    .join("");

  return `<div style="margin-top:16px;">${rows}</div>`;
}

export function renderLargeAttachmentRecipientText(
  cards: LargeAttachmentRecipientCard[],
): string {
  if (cards.length === 0) {
    return "";
  }

  return [
    "",
    "大附件",
    ...cards.flatMap((card) => [
      `Large attachment: ${card.filename} (${formatSize(card.sizeBytes)})`,
      `Download: ${card.downloadUrl}`,
      "Security notice: This file has not been automatically scanned. Only download or open it if you trust the sender/source.",
      `Link expires in: ${formatExpiry()}`,
      "",
    ]),
  ].join("\n");
}

export function appendLargeAttachmentRecipientContent(input: {
  bodyText: string | null;
  bodyHtml: string | null;
  cards: LargeAttachmentRecipientCard[];
}): { bodyText: string | null; bodyHtml: string | null } {
  if (input.cards.length === 0) {
    return {
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml,
    };
  }

  const cardText = renderLargeAttachmentRecipientText(input.cards);
  const cardHtml = renderLargeAttachmentRecipientHtml(input.cards);

  return {
    bodyText: `${input.bodyText ?? ""}${cardText}`,
    bodyHtml: `${input.bodyHtml ?? ""}${cardHtml}`,
  };
}

export function isLargeAttachmentRevisionAttachment(
  attachment: Pick<MailOutboundRevisionAttachment, "deliveryMode">,
): boolean {
  return attachment.deliveryMode === "large_attachment";
}
