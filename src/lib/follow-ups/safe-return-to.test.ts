import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FOLLOW_UPS_LINK_RETURN_PARAM,
  FOLLOW_UPS_SAFE_RETURN_MAX_LENGTH,
  appendFollowUpsReturnTo,
  buildFollowUpsReturnTo,
  getFollowUpsLinkReturnNonce,
  parseSafeFollowUpsReturnTo,
  stripFollowUpsLinkReturnNonce,
  withFollowUpsLinkReturnNonce,
} from "./safe-return-to";

describe("follow-ups safe returnTo helper", () => {
  it("accepts /follow-ups and query variants", () => {
    assert.equal(parseSafeFollowUpsReturnTo("/follow-ups"), "/follow-ups");
    assert.equal(buildFollowUpsReturnTo("/follow-ups/"), "/follow-ups");
    assert.equal(
      parseSafeFollowUpsReturnTo(
        "/follow-ups?q=abc&from=2026-01-01&to=2026-01-31&channel=phone&staff=u1",
      ),
      "/follow-ups?q=abc&from=2026-01-01&to=2026-01-31&channel=phone&staff=u1",
    );
  });

  it("preserves unrelated safe query params", () => {
    assert.equal(
      parseSafeFollowUpsReturnTo("/follow-ups?q=a&utm=1"),
      "/follow-ups?q=a&utm=1",
    );
  });

  it("rejects external, protocol-relative, and dangerous schemes", () => {
    assert.equal(parseSafeFollowUpsReturnTo("https://evil.example"), null);
    assert.equal(parseSafeFollowUpsReturnTo("http://evil.example/follow-ups"), null);
    assert.equal(parseSafeFollowUpsReturnTo("//evil.example"), null);
    assert.equal(parseSafeFollowUpsReturnTo("javascript:alert(1)"), null);
    assert.equal(parseSafeFollowUpsReturnTo("data:text/html,hi"), null);
  });

  it("rejects encoded and double-encoded external URLs", () => {
    assert.equal(
      parseSafeFollowUpsReturnTo("https%3A%2F%2Fevil.example"),
      null,
    );
    assert.equal(
      parseSafeFollowUpsReturnTo("%252F%252Fevil.example"),
      null,
    );
    assert.equal(
      parseSafeFollowUpsReturnTo("%2F%2Fevil.example"),
      null,
    );
  });

  it("rejects CRLF, null byte, and backslash forms", () => {
    assert.equal(parseSafeFollowUpsReturnTo("/follow-ups\r\n"), null);
    assert.equal(parseSafeFollowUpsReturnTo("/follow-ups\0"), null);
    assert.equal(parseSafeFollowUpsReturnTo("\\/\\/evil.example"), null);
    assert.equal(parseSafeFollowUpsReturnTo("/follow-ups\\evil"), null);
  });

  it("rejects lookalike routes", () => {
    assert.equal(parseSafeFollowUpsReturnTo("/follow-ups-evil"), null);
    assert.equal(parseSafeFollowUpsReturnTo("/follow-ups.evil"), null);
    assert.equal(parseSafeFollowUpsReturnTo("/customers"), null);
    assert.equal(parseSafeFollowUpsReturnTo("/follow-ups/extra"), null);
  });

  it("rejects oversized input", () => {
    const oversized = `/follow-ups?q=${"a".repeat(FOLLOW_UPS_SAFE_RETURN_MAX_LENGTH)}`;
    assert.equal(parseSafeFollowUpsReturnTo(oversized), null);
  });

  it("returns null on decode errors and non-strings", () => {
    assert.equal(parseSafeFollowUpsReturnTo("%E0%A4%A"), null);
    assert.equal(parseSafeFollowUpsReturnTo(null), null);
    assert.equal(parseSafeFollowUpsReturnTo(12), null);
  });

  it("never returns an origin", () => {
    const safe = parseSafeFollowUpsReturnTo("/follow-ups?q=1");
    assert.ok(safe);
    assert.doesNotMatch(safe, /^https?:/i);
    assert.doesNotMatch(safe, /crm\.invalid/);
  });

  it("appendFollowUpsReturnTo encodes returnTo on customer href", () => {
    const href = appendFollowUpsReturnTo(
      "/customers/cust_1",
      "/follow-ups?q=abc&channel=phone",
    );
    assert.match(href, /^\/customers\/cust_1\?returnTo=/);
    const params = new URLSearchParams(href.slice(href.indexOf("?")));
    assert.equal(
      params.get("returnTo"),
      "/follow-ups?q=abc&channel=phone",
    );
    assert.doesNotMatch(href, /scrollY/);
    assert.doesNotMatch(href, /summary/);
  });

  it("appendFollowUpsReturnTo ignores unsafe return paths", () => {
    assert.equal(
      appendFollowUpsReturnTo("/customers/cust_1", "https://evil.example"),
      "/customers/cust_1",
    );
  });

  it("link-return nonce helpers round-trip and strip cleanly", () => {
    const withNonce = withFollowUpsLinkReturnNonce("/follow-ups?q=a", "abc123");
    assert.ok(withNonce);
    assert.equal(getFollowUpsLinkReturnNonce(withNonce), "abc123");
    assert.match(withNonce, new RegExp(`${FOLLOW_UPS_LINK_RETURN_PARAM}=abc123`));
    assert.equal(stripFollowUpsLinkReturnNonce(withNonce), "/follow-ups?q=a");
  });
});
