import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOutboundRfcThreadingHeaders,
  deriveOutboundInReplyTo,
  deriveOutboundReferencesHeader,
  parseRfcMessageIdTokens,
  sanitizeRfcMessageIdToken,
} from "@/lib/mail/outbound-rfc-threading";

describe("outbound RFC threading helpers", () => {
  it("parses and sanitizes Message-ID tokens", () => {
    assert.deepEqual(
      parseRfcMessageIdTokens("<a@example.com> <b@example.com>"),
      ["<a@example.com>", "<b@example.com>"],
    );
    assert.equal(
      sanitizeRfcMessageIdToken("<valid@example.com>"),
      "<valid@example.com>",
    );
    assert.equal(sanitizeRfcMessageIdToken("invalid"), null);
    assert.equal(sanitizeRfcMessageIdToken("<bad\r\n@example.com>"), null);
  });

  it("derives References with dedupe and source append", () => {
    const result = deriveOutboundReferencesHeader({
      sourceReferencesHeader: "<parent@example.com>",
      sourceWireMessageId: "<source@example.com>",
    });
    assert.match(result ?? "", /<parent@example.com>/);
    assert.match(result ?? "", /<source@example.com>/);
  });

  it("deduplicates source Message-ID in References", () => {
    const result = deriveOutboundReferencesHeader({
      sourceReferencesHeader: "<source@example.com>",
      sourceWireMessageId: "<source@example.com>",
    });
    assert.equal(result, "<source@example.com>");
  });

  it("returns null In-Reply-To when source wire ID missing", () => {
    assert.equal(deriveOutboundInReplyTo(null), null);
    const headers = buildOutboundRfcThreadingHeaders({
      sourceReferencesHeader: null,
      sourceWireMessageId: null,
    });
    assert.equal(headers.inReplyTo, null);
    assert.equal(headers.referencesHeader, null);
  });

  it("rejects CR/LF injection in References input", () => {
    const result = deriveOutboundReferencesHeader({
      sourceReferencesHeader: "<evil\r\n@example.com>",
      sourceWireMessageId: "<good@example.com>",
    });
    assert.equal(result, "<good@example.com>");
  });
});
