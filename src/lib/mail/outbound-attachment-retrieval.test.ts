import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MemoryOutboundAttachmentByteReader,
} from "@/lib/mail/outbound-attachment-retrieval";
import { computeInboundPayloadContentHash } from "@/lib/mail/inbound-payload-hash";
import { isMailOutboundTransportEnabled } from "@/lib/mail/outbound-transport-constants";

describe("outbound attachment retrieval", () => {
  it("reads attachment bytes from memory storage by storage key", async () => {
    const bytes = new TextEncoder().encode("attachment-bytes");
    const storageKey = "mail/outbound-attachments/test-key";
    const reader = new MemoryOutboundAttachmentByteReader(
      new Map([[storageKey, bytes]]),
    );

    const loaded = await reader.read({
      revisionAttachmentId: "rev-att-1",
      storedFileId: "file-1",
      contentHash: computeInboundPayloadContentHash(bytes),
      displayFilename: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: bytes.byteLength,
      storageProvider: "r2",
      storageBucket: "memory",
      storageKey,
    });

    assert.deepEqual(loaded, bytes);
  });
});

describe("outbound transport feature gate", () => {
  it("defaults to disabled", () => {
    assert.equal(isMailOutboundTransportEnabled({}), false);
  });
});
