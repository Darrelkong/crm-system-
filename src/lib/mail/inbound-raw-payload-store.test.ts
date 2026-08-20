import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INBOUND_RAW_PAYLOAD_KEY_PREFIX,
  MemoryInboundRawPayloadStore,
} from "@/lib/mail/inbound-raw-payload-store";
import { computeInboundPayloadContentHash } from "@/lib/mail/inbound-payload-hash";

describe("MemoryInboundRawPayloadStore", () => {
  it("put/get round-trips exact bytes with opaque key prefix", async () => {
    const store = new MemoryInboundRawPayloadStore();
    const bytes = new TextEncoder().encode("raw mime blob");
    const stored = await store.put(bytes);
    assert.ok(stored.storageKey.startsWith(INBOUND_RAW_PAYLOAD_KEY_PREFIX));
    assert.doesNotMatch(stored.storageKey, /mime|recipient|@/i);

    const read = await store.get(stored.storageKey);
    assert.ok(read);
    assert.equal(Buffer.from(read).compare(Buffer.from(bytes)), 0);
    assert.equal(
      computeInboundPayloadContentHash(read),
      computeInboundPayloadContentHash(bytes),
    );
    assert.equal(await store.exists(stored.storageKey), true);
  });
});
