import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLargeAttachmentR2PutHeaders,
  type LargeAttachmentAuthorizeResponse,
} from "@/lib/mail/client/compose-large-attachment-upload";

describe("large attachment R2 PUT request construction", () => {
  it("includes exactly the authorization-required headers", () => {
    const authorization: LargeAttachmentAuthorizeResponse = {
      uploadSessionId: "session-1",
      uploadUrl: "https://example.r2.cloudflarestorage.com/bucket/key?sig=abc",
      requiredHeaders: {
        "Content-Type": "application/zip",
        "Content-MD5": "1B2M2Y8AsgTpgAmY7PhCfg==",
        "If-None-Match": "*",
      },
      expiresAt: "2026-08-30T10:10:00.000Z",
    };
    const headers = buildLargeAttachmentR2PutHeaders(authorization);
    assert.deepEqual(headers, {
      "Content-Type": "application/zip",
      "Content-MD5": "1B2M2Y8AsgTpgAmY7PhCfg==",
      "If-None-Match": "*",
    });
    assert.equal(Object.keys(headers).length, 3);
    for (const forbidden of ["x-amz-acl", "x-amz-meta-test", "Authorization"]) {
      assert.equal(Object.hasOwn(headers, forbidden), false);
    }
  });
});
