import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INLINE_SIGNATURE_ASSET_REFERENCE_POLICY,
  SIGNATURE_HTML_SANITIZER_AVAILABLE,
  assertSignatureAssetMimeType,
} from "@/lib/mail/signature-html-policy";
import { sanitizeOptionalSignatureHtml } from "@/lib/mail/signature-html-sanitizer";

describe("signature html policy", () => {
  it("reports trusted sanitizer available", () => {
    assert.equal(SIGNATURE_HTML_SANITIZER_AVAILABLE, true);
  });

  it("defers inline img asset reference policy", () => {
    assert.equal(INLINE_SIGNATURE_ASSET_REFERENCE_POLICY, "NOT_YET_FROZEN");
  });

  it("sanitizes non-empty HTML via trusted library", () => {
    const sanitized = sanitizeOptionalSignatureHtml("<p>Hello</p>");
    assert.equal(sanitized, "<p>Hello</p>");
  });

  it("returns null for empty HTML", () => {
    assert.equal(sanitizeOptionalSignatureHtml(null), null);
    assert.equal(sanitizeOptionalSignatureHtml("   "), null);
  });

  it("accepts image MIME types for signature assets", () => {
    assert.doesNotThrow(() => assertSignatureAssetMimeType("image/png"));
  });

  it("rejects non-image MIME types for signature assets", () => {
    assert.throws(() => assertSignatureAssetMimeType("application/pdf"));
  });
});
