import { createHash } from "node:crypto";

/** V1: SHA-256 lowercase hex — matches 0061 payload_content_hash CHECK (64 hex chars). */
export function computeInboundPayloadContentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function toPayloadByteArray(
  input: Uint8Array | ArrayBuffer | Buffer,
): Uint8Array {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(input)) {
    return new Uint8Array(input);
  }
  return new Uint8Array(input);
}
