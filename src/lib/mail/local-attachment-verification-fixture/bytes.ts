import { createHash } from "node:crypto";
import { computeInboundPayloadContentHash } from "@/lib/mail/inbound-payload-hash";

export function buildFixturePdfBytes(): Uint8Array {
  const content = Buffer.from(
    "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
    "utf8",
  );
  return new Uint8Array(content);
}

/** 1x1 transparent PNG. */
export function buildFixturePngBytes(): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

export function buildFixtureBinaryBytes(seed: string): Uint8Array {
  const digest = createHash("sha256").update(seed, "utf8").digest();
  return new Uint8Array(digest.subarray(0, 32));
}

export function hashFixtureBytes(bytes: Uint8Array): string {
  return computeInboundPayloadContentHash(bytes);
}

export const FIXTURE_ATTACHMENT_BYTES = {
  cleanPdf: buildFixturePdfBytes(),
  cleanPng: buildFixturePngBytes(),
  cleanBinary: buildFixtureBinaryBytes("2h5b-clean-binary"),
  unscanned: buildFixtureBinaryBytes("2h5b-unscanned"),
  blocked: buildFixtureBinaryBytes("2h5b-blocked"),
  scanFailed: buildFixtureBinaryBytes("2h5b-scan-failed"),
  secureFile: buildFixtureBinaryBytes("2h5b-secure-file"),
  sharedClean: buildFixtureBinaryBytes("2h5b-shared-clean"),
  unauthorizedMailbox: buildFixtureBinaryBytes("2h5b-unauthorized"),
  headerInjection: buildFixtureBinaryBytes("2h5b-header-injection"),
  sharedFileReuse: buildFixtureBinaryBytes("2h5b-shared-file-reuse"),
  trashedClean: buildFixtureBinaryBytes("2h5b-trashed-clean"),
} as const;
