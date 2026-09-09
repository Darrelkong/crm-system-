import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLargeAttachmentR2PutHeaders,
  putLargeAttachmentToR2WithProgress,
  type LargeAttachmentAuthorizeResponse,
} from "@/lib/mail/client/compose-large-attachment-upload";

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

class FakeXMLHttpRequest {
  static latest: FakeXMLHttpRequest | null = null;

  status = 0;
  upload: {
    onprogress: ((event: ProgressEvent<EventTarget>) => void) | null;
  } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXMLHttpRequest.latest = this;
  }

  open(_method: string, _url: string): void {}

  setRequestHeader(_name: string, _value: string): void {}

  send(_body: File): void {}

  triggerLoad(status: number): void {
    this.status = status;
    this.onload?.();
  }

  triggerError(): void {
    this.onerror?.();
  }

  triggerAbort(): void {
    this.onabort?.();
  }
}

async function runWithFakeXhr(
  trigger: (xhr: FakeXMLHttpRequest) => void,
): Promise<Awaited<ReturnType<typeof putLargeAttachmentToR2WithProgress>>> {
  const original = globalThis.XMLHttpRequest;
  Object.defineProperty(globalThis, "XMLHttpRequest", {
    configurable: true,
    writable: true,
    value: FakeXMLHttpRequest,
  });
  try {
    const result = putLargeAttachmentToR2WithProgress({
      authorization,
      file: {} as File,
    });
    const xhr = FakeXMLHttpRequest.latest;
    assert.ok(xhr);
    trigger(xhr);
    return await result;
  } finally {
    Object.defineProperty(globalThis, "XMLHttpRequest", {
      configurable: true,
      writable: true,
      value: original,
    });
  }
}

describe("large attachment R2 PUT request construction", () => {
  it("includes exactly the authorization-required headers", () => {
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

  it("maps HTTP failures to sanitized status diagnostic codes", async () => {
    for (const status of [403, 400, 412]) {
      const result = await runWithFakeXhr((xhr) => xhr.triggerLoad(status));
      assert.deepEqual(result, {
        ok: false,
        status,
        error: "Large attachment upload to storage failed",
        errorCode: `LA_R2_HTTP_${status}`,
      });
    }
  });

  it("maps network errors to the sanitized network/CORS code", async () => {
    assert.deepEqual(
      await runWithFakeXhr((xhr) => xhr.triggerError()),
      {
        ok: false,
        status: 0,
        error: "Large attachment upload network error",
        errorCode: "LA_R2_NETWORK_OR_CORS",
      },
    );
  });

  it("maps aborts to the sanitized abort code and preserves cancellation", async () => {
    assert.deepEqual(
      await runWithFakeXhr((xhr) => xhr.triggerAbort()),
      {
        ok: false,
        status: 0,
        error: "Upload cancelled",
        errorCode: "LA_R2_ABORTED",
        cancelled: true,
      },
    );
  });

  it("keeps successful 2xx PUT behavior unchanged", async () => {
    assert.deepEqual(
      await runWithFakeXhr((xhr) => xhr.triggerLoad(204)),
      { ok: true },
    );
  });
});
