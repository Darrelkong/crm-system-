import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MailServiceError } from "@/lib/mail/errors";
import {
  isOutboundBodySanitizerIdempotent,
  sanitizeOptionalOutboundBodyHtml,
  sanitizeOutboundBodyHtml,
} from "@/lib/mail/outbound-body-html-sanitizer";

describe("outbound body html sanitizer", () => {
  it("sanitizes safe compose html", () => {
    const result = sanitizeOutboundBodyHtml("<p>Hello <strong>team</strong></p>");
    assert.match(result, /<p>Hello <strong>team<\/strong><\/p>/);
  });

  it("rejects inline data images", () => {
    assert.throws(
      () =>
        sanitizeOutboundBodyHtml(
          '<p>Hi</p><img src="data:image/png;base64,abc" />',
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );
  });

  it("is idempotent for allowed markup", () => {
    const input = "<p>Hello</p><ul><li>One</li></ul>";
    assert.equal(isOutboundBodySanitizerIdempotent(input), true);
  });

  it("returns null for optional empty html", () => {
    assert.equal(sanitizeOptionalOutboundBodyHtml(""), null);
    assert.equal(sanitizeOptionalOutboundBodyHtml("   "), null);
  });
});
