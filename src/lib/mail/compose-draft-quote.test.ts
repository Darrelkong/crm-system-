import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildForwardQuoteBody,
  buildReplyQuoteBody,
} from "@/lib/mail/compose-draft-quote";

describe("compose draft quote builder", () => {
  it("builds reply quote with sender and sanitized body", () => {
    const result = buildReplyQuoteBody({
      message: {
        fromAddress: "sender@example.com",
        fromDisplayName: "Sender",
        direction: "inbound",
        receivedAt: "2026-06-26T12:01:00.000Z",
        sentAt: null,
      },
      source: {
        bodyText: "Original text",
        bodyHtmlSanitized: "<p>Original html</p>",
        quotedText: null,
        quotedHtmlSanitized: null,
      },
    });
    assert.match(result.bodyText, /Sender <sender@example.com> wrote:/);
    assert.match(result.bodyText, /Original text/);
    assert.doesNotMatch(result.bodyHtml ?? "", /<script/i);
    assert.match(result.bodyHtml ?? "", /Original html/);
  });

  it("forward header excludes Bcc and includes To/Cc only", () => {
    const result = buildForwardQuoteBody({
      message: {
        fromAddress: "sender@example.com",
        fromDisplayName: "Sender",
        subject: "Subject line",
        direction: "inbound",
        receivedAt: "2026-06-26T12:01:00.000Z",
        sentAt: null,
      },
      visibleRecipients: [
        { recipientType: "to", address: "to@example.com", displayName: null, sortOrder: 0 },
        { recipientType: "cc", address: "cc@example.com", displayName: null, sortOrder: 1 },
        { recipientType: "bcc", address: "hidden@example.com", displayName: null, sortOrder: 2 },
      ],
      source: {
        bodyText: "Forwarded body",
        bodyHtmlSanitized: "<p>Forwarded body</p>",
        quotedText: null,
        quotedHtmlSanitized: null,
      },
    });
    assert.match(result.bodyText, /Forwarded message/);
    assert.match(result.bodyText, /To: to@example.com/);
    assert.match(result.bodyText, /Cc: cc@example.com/);
    assert.doesNotMatch(result.bodyText, /hidden@example.com/);
    assert.doesNotMatch(result.bodyText, /Bcc:/);
  });
});
