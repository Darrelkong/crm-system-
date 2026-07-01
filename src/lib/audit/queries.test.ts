import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUDIT_LOG_DEFAULT_LIMIT,
  AUDIT_LOG_MAX_LIMIT,
  decodeAuditLogCursor,
  encodeAuditLogCursor,
  parseAuditLogLimitParam,
  parseAuditMetadata,
  resolveAuditLogLimit,
} from "@/lib/audit/queries";

describe("audit log query helpers", () => {
  it("parseAuditMetadata returns object for valid JSON", () => {
    const metadata = parseAuditMetadata(
      JSON.stringify({ scope: "all_active", includeSensitive: false }),
    );
    assert.deepEqual(metadata, {
      scope: "all_active",
      includeSensitive: false,
    });
  });

  it("parseAuditMetadata returns null for empty or invalid JSON", () => {
    assert.equal(parseAuditMetadata(null), null);
    assert.equal(parseAuditMetadata(""), null);
    assert.equal(parseAuditMetadata("{not-json"), null);
    assert.equal(parseAuditMetadata(JSON.stringify(["array"])), null);
  });

  it("resolveAuditLogLimit defaults to 50 and caps at 100", () => {
    assert.equal(resolveAuditLogLimit(), AUDIT_LOG_DEFAULT_LIMIT);
    assert.equal(resolveAuditLogLimit(0), AUDIT_LOG_DEFAULT_LIMIT);
    assert.equal(resolveAuditLogLimit(-1), AUDIT_LOG_DEFAULT_LIMIT);
    assert.equal(resolveAuditLogLimit(50), 50);
    assert.equal(resolveAuditLogLimit(100), 100);
    assert.equal(resolveAuditLogLimit(200), AUDIT_LOG_MAX_LIMIT);
  });

  it("parseAuditLogLimitParam parses query values", () => {
    assert.equal(parseAuditLogLimitParam(null), AUDIT_LOG_DEFAULT_LIMIT);
    assert.equal(parseAuditLogLimitParam(""), AUDIT_LOG_DEFAULT_LIMIT);
    assert.equal(parseAuditLogLimitParam("abc"), AUDIT_LOG_DEFAULT_LIMIT);
    assert.equal(parseAuditLogLimitParam("75"), 75);
    assert.equal(parseAuditLogLimitParam("150"), AUDIT_LOG_MAX_LIMIT);
  });

  it("encode/decode audit log cursor round-trips", () => {
    const cursor = encodeAuditLogCursor("2026-06-30T12:00:00.000Z", "audit-id-1");
    const decoded = decodeAuditLogCursor(cursor);
    assert.deepEqual(decoded, {
      createdAt: "2026-06-30T12:00:00.000Z",
      id: "audit-id-1",
    });
    assert.equal(decodeAuditLogCursor("not-a-cursor"), null);
  });
});
