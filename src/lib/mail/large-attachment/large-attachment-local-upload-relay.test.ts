import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  buildLocalLargeAttachmentUploadUrl,
  isLocalLargeAttachmentRelayEnabled,
  streamLocalLargeAttachmentUpload,
  type LocalLargeAttachmentBucket,
} from "@/lib/mail/large-attachment/large-attachment-local-upload-relay";
import type { LargeAttachmentUploadSession } from "@/lib/mail/large-attachment/large-attachment-upload-session";

type StoredObject = {
  bytes: Uint8Array;
  contentType: string;
  contentMd5: string;
};

type LocalPutOptions = {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
};

function makeBucket() {
  const objects = new Map<string, StoredObject>();
  const putBodies: unknown[] = [];
  const deletedKeys: string[] = [];
  const bucket = {
    async head(key: string) {
      const stored = objects.get(key);
      if (!stored) return null;
      return {
        size: stored.bytes.byteLength,
        httpMetadata: { contentType: stored.contentType },
        customMetadata: {
          "large-attachment-content-md5": stored.contentMd5,
        },
      };
    },
    async put(
      key: string,
      body: unknown,
      options?: LocalPutOptions,
    ): Promise<unknown> {
      assert.ok(body instanceof Request || body instanceof ReadableStream);
      putBodies.push(body);
      const stream = body instanceof Request ? body.body : body;
      assert.ok(stream instanceof ReadableStream);
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        const chunk = new Uint8Array(next.value);
        chunks.push(chunk);
        total += chunk.byteLength;
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      objects.set(key, {
        bytes,
        contentType: options?.httpMetadata?.contentType ?? "",
        contentMd5: options?.customMetadata?.["large-attachment-content-md5"] ?? "",
      });
      return {};
    },
    async delete(key: string) {
      deletedKeys.push(key);
      objects.delete(key);
    },
  } as unknown as LocalLargeAttachmentBucket;
  return { bucket, objects, putBodies, deletedKeys };
}

function session(overrides: Partial<LargeAttachmentUploadSession> = {}) {
  return {
    id: "session-1",
    actorUserId: "user-1",
    draftId: "draft-1",
    mailboxId: "mailbox-1",
    storedFileId: null,
    storageKey: "mail/large-attachments/2026/09/session-1",
    expectedFilename: "sample.mov",
    expectedMimeType: "video/quicktime",
    expectedSizeBytes: 6,
    maxSizeBytes: 100 * 1024 * 1024,
    declaredContentHash: "a".repeat(64),
    expiresAt: "2026-09-07T00:00:00.000Z",
    finalizedAt: null,
    invalidatedAt: null,
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
    ...overrides,
  } satisfies LargeAttachmentUploadSession;
}

function md5(bytes: Uint8Array): string {
  return createHash("md5").update(bytes).digest("base64");
}

function requestFor(bytes: Uint8Array, contentMd5: string): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 2));
      controller.enqueue(bytes.slice(2));
      controller.close();
    },
  });
  const requestInit = {
    method: "PUT",
    body,
    headers: {
      "Content-Type": "video/quicktime",
      "Content-MD5": contentMd5,
      "Content-Length": String(bytes.byteLength),
      "If-None-Match": "*",
    },
    duplex: "half",
  } as RequestInit;
  return new Request("http://localhost/upload", requestInit);
}

describe("local large attachment upload relay", () => {
  it("is enabled only for a development runtime", () => {
    assert.equal(
      isLocalLargeAttachmentRelayEnabled({
        NODE_ENV: "development",
        MAIL_LARGE_ATTACHMENT_LOCAL_RELAY_ENABLED: "true",
      }),
      true,
    );
    assert.equal(
      isLocalLargeAttachmentRelayEnabled({
        NODE_ENV: "production",
        MAIL_LARGE_ATTACHMENT_LOCAL_RELAY_ENABLED: "true",
      }),
      false,
    );
    assert.equal(
      buildLocalLargeAttachmentUploadUrl({
        draftId: "draft/1",
        sessionId: "session/1",
      }),
      "/api/mail/drafts/draft%2F1/large-attachments/session%2F1/upload",
    );
  });

  it("streams a MOV-like body into local R2 and validates MD5", async () => {
    const bytes = new TextEncoder().encode("mov-v1");
    const { bucket, objects, putBodies } = makeBucket();

    const result = await streamLocalLargeAttachmentUpload({
      request: requestFor(bytes, md5(bytes)),
      bucket,
      session: session(),
    });

    assert.equal(result.sizeBytes, bytes.byteLength);
    assert.equal(result.contentMd5Base64, md5(bytes));
    assert.equal(result.reusedExisting, false);
    assert.equal(putBodies.length, 1);
    assert.deepEqual(objects.get("mail/large-attachments/2026/09/session-1")?.bytes, bytes);
  });

  it("deletes a locally stored object when the streamed MD5 is wrong", async () => {
    const bytes = new TextEncoder().encode("mov-v1");
    const { bucket, objects, deletedKeys } = makeBucket();

    await assert.rejects(
      streamLocalLargeAttachmentUpload({
        request: requestFor(bytes, "1B2M2Y8AsgTpgAmY7PhCfg=="),
        bucket,
        session: session(),
      }),
      /integrity check failed/i,
    );

    assert.equal(objects.size, 0);
    assert.deepEqual(deletedKeys, ["mail/large-attachments/2026/09/session-1"]);
  });

  it("reuses a matching completed local object for a retry", async () => {
    const bytes = new TextEncoder().encode("mov-v1");
    const { bucket, objects, putBodies } = makeBucket();
    objects.set("mail/large-attachments/2026/09/session-1", {
      bytes,
      contentType: "video/quicktime",
      contentMd5: md5(bytes),
    });

    const result = await streamLocalLargeAttachmentUpload({
      request: requestFor(bytes, md5(bytes)),
      bucket,
      session: session(),
    });

    assert.equal(result.reusedExisting, true);
    assert.equal(putBodies.length, 0);
  });
});
