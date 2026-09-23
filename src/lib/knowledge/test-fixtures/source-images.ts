import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const testFixturesDir = dirname(fileURLToPath(import.meta.url));
const previewIngestDir = join(process.cwd(), "preview-fixtures/knowledge-ingest");

function toArrayBuffer(bytes: Buffer): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function loadKnowledgeTestFixtureBytes(filename: string): ArrayBuffer {
  return toArrayBuffer(readFileSync(join(testFixturesDir, filename)));
}

export function loadKnowledgePreviewIngestFixtureBytes(filename: string): ArrayBuffer {
  const resolved = join(previewIngestDir, filename);
  if (!resolved.startsWith(previewIngestDir)) {
    throw new Error("Invalid Knowledge preview ingest fixture path");
  }
  return toArrayBuffer(readFileSync(resolved));
}

/** 1x1 PNG (valid magic bytes). */
export function buildTestPngBytes(): ArrayBuffer {
  const base64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const bytes = Buffer.from(base64, "base64");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** Valid PNG with unique pixel data for isolated binary-dedup tests. */
export function buildUniqueTestPngBytes(seed: number): ArrayBuffer {
  const channel = Math.max(0, Math.min(255, seed % 256));
  const base64 = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
    0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
    0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08,
    0xd7, 0x63, channel, channel, channel, 0x00, 0x02, 0x8d, 0x0d, 0x0a, 0x1d, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]).toString("base64");
  const bytes = Buffer.from(base64, "base64");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** Minimal valid JPEG (valid magic bytes). */
export function buildTestJpegBytes(): ArrayBuffer {
  const base64 =
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q==";
  const bytes = Buffer.from(base64, "base64");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** WebP RIFF header — rejected in B1. */
export function buildTestWebpBytes(): ArrayBuffer {
  const bytes = Buffer.from("RIFF....WEBPVP8 ", "ascii");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
