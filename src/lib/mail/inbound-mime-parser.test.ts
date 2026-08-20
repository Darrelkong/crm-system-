import assert from "node:assert/strict";
import { describe, it } from "node:test";
import PostalMime from "postal-mime";
import { parseInboundMimeBytes } from "@/lib/mail/inbound-mime-parser";

function encodeMime(raw: string): Uint8Array {
  return new TextEncoder().encode(raw);
}

describe("postal-mime compatibility", () => {
  it("parses multipart MIME in worker-compatible runtime", async () => {
    const raw = encodeMime(
      [
        "From: Sender <sender@external.test>",
        "To: Visible <visible@example.com>",
        "Subject: =?UTF-8?B?SGVsbG8g8J+RjA==?=",
        "Message-ID: <compat-msg@external.test>",
        "MIME-Version: 1.0",
        "Content-Type: multipart/alternative; boundary=abc",
        "",
        "--abc",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Plain body",
        "--abc",
        "Content-Type: text/html; charset=utf-8",
        "",
        "<p>HTML body</p>",
        "--abc--",
      ].join("\r\n"),
    );

    const postal = await PostalMime.parse(raw);
    assert.equal(postal.subject, "Hello 👌");
    const parsed = await parseInboundMimeBytes(raw);
    assert.equal(parsed.fromAddress, "sender@external.test");
    assert.equal(parsed.internetMessageId, "<compat-msg@external.test>");
    assert.equal(parsed.recipients.length, 1);
    assert.equal(parsed.recipients[0]?.address, "visible@example.com");
    assert.match(parsed.bodyText, /Plain body/);
    assert.match(parsed.bodyHtmlSanitized ?? "", /HTML body/);
  });
});

describe("parseInboundMimeBytes envelope/header boundary", () => {
  it("does not fabricate envelope recipient into MIME To/Bcc", async () => {
    const raw = encodeMime(
      [
        "From: Sender <sender@external.test>",
        "To: Someone <someone@example.com>",
        "Subject: BCC boundary",
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Hello",
      ].join("\r\n"),
    );

    const parsed = await parseInboundMimeBytes(raw);
    assert.equal(parsed.recipients.length, 1);
    assert.equal(parsed.recipients[0]?.recipientType, "to");
    assert.equal(parsed.recipients[0]?.address, "someone@example.com");
    assert.equal(
      parsed.recipients.some((row) => row.address === "hidden@echfronthk.com"),
      false,
    );
  });
});
