import { renderLargeAttachmentRecipientHtml } from "@/lib/mail/large-attachment/large-attachment-recipient-card";

export const dynamic = "force-dynamic";

const SYNTHETIC_TOKEN = "local-preview-token-1234567890";

function localPreviewEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.MAIL_LARGE_ATTACHMENT_LOCAL_PREVIEW_ENABLED === "true"
  );
}

export async function GET(): Promise<Response> {
  if (!localPreviewEnabled()) {
    return new Response("Not found", { status: 404 });
  }

  const cardHtml = renderLargeAttachmentRecipientHtml([
    {
      attachmentId: "local-preview-large-attachment",
      filename: "IMG_5940.mov",
      sizeBytes: 16_800_000,
      downloadUrl: `https://files.local.test/f/${SYNTHETIC_TOKEN}`,
      recipientExpiresAt: "2026-09-14T12:00:00.000Z",
    },
  ]);

  return new Response(
    `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Local Large Attachment Preview</title>
  </head>
  <body style="margin:0;background:#f5f7fa;color:#172033;font-family:Arial,sans-serif;line-height:1.5">
    <main style="max-width:720px;margin:0 auto;padding:24px 16px">
      <p style="color:#7a4b00;font-size:13px">LOCAL ONLY · synthetic data · not a real email</p>
      <section style="background:#fff;border:1px solid #d9dee8;border-radius:12px;padding:20px">
        <h1 style="font-size:20px;margin:0 0 12px">Recipient email card</h1>
        <p>This is the generated recipient content. The original body is not modified.</p>
        ${cardHtml}
      </section>
      <section style="margin-top:20px;background:#fff7e6;border:1px solid #e6c98a;border-radius:12px;padding:20px">
        <h2 style="font-size:18px;margin:0 0 8px">Gateway warning page</h2>
        <p>此大附件未經自動安全掃描。請只在確認寄件者及檔案來源可信後繼續。</p>
        <p style="color:#6c4d00;font-size:13px">This large attachment was not automatically scanned. Confirm the sender and file source before continuing.</p>
        <a href="#synthetic-download" style="display:inline-block;padding:10px 14px;background:#1769aa;color:#fff;border-radius:8px;text-decoration:none">繼續下載</a>
        <p id="synthetic-download" style="font-size:13px;color:#526075">Synthetic preview only; no file is downloaded.</p>
      </section>
    </main>
  </body>
</html>`,
    {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    },
  );
}
