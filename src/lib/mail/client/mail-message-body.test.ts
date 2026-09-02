import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSafePlainTextUrl,
  resolveMailMessageBody,
} from "@/lib/mail/client/mail-message-body";

describe("mail message body resolver", () => {
  it("prefers meaningful sanitized HTML over plain text", () => {
    assert.deepEqual(
      resolveMailMessageBody({
        bodyHtml: "<p><strong>Rich body</strong></p>",
        bodyText: "Plain fallback",
      }),
      { mode: "html", content: "<p><strong>Rich body</strong></p>" },
    );
  });

  it("falls back to text when HTML is empty after sanitization", () => {
    assert.deepEqual(
      resolveMailMessageBody({
        bodyHtml: null,
        bodyText: "Readable fallback",
      }),
      { mode: "plain_text", content: "Readable fallback" },
    );
  });

  it("resolves empty content deterministically", () => {
    assert.deepEqual(
      resolveMailMessageBody({ bodyHtml: " <p>&nbsp;</p> ", bodyText: "  " }),
      { mode: "empty", content: "" },
    );
  });

  it("accepts only HTTP(S) links for plain-text linkification", () => {
    assert.equal(isSafePlainTextUrl("https://example.com/path"), true);
    assert.equal(isSafePlainTextUrl("http://example.com/path"), true);
    assert.equal(isSafePlainTextUrl("javascript:alert(1)"), false);
    assert.equal(isSafePlainTextUrl("/admin"), false);
    assert.equal(isSafePlainTextUrl("data:text/html,evil"), false);
  });
});
