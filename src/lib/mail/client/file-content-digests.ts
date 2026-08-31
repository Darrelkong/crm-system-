import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import SparkMD5 from "spark-md5";

const CHUNK_SIZE = 2 * 1024 * 1024;

async function forEachFileChunk(
  file: File,
  consume: (chunk: Uint8Array) => void,
): Promise<void> {
  let offset = 0;
  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    consume(chunk);
    offset = end;
  }
}

/**
 * Client-declared SHA-256 fingerprint (logical content identity).
 * NOT server-verified by CRM at authorize time.
 */
export async function computeDeclaredSha256Hex(file: File): Promise<string> {
  const hasher = sha256.create();
  await forEachFileChunk(file, (chunk) => {
    hasher.update(chunk);
  });
  return bytesToHex(hasher.digest());
}

/**
 * Content-MD5 base64 for R2/S3 transport integrity enforcement only.
 * NOT a cryptographic content identity or authorization token.
 */
export async function computeContentMd5Base64(file: File): Promise<string> {
  const spark = new SparkMD5.ArrayBuffer();
  await forEachFileChunk(file, (chunk) => {
    spark.append(
      chunk.buffer.slice(
        chunk.byteOffset,
        chunk.byteOffset + chunk.byteLength,
      ) as ArrayBuffer,
    );
  });
  return btoa(spark.end(true));
}

export async function computeFileContentDigests(file: File): Promise<{
  declaredSha256: string;
  contentMd5Base64: string;
}> {
  const declaredSha256 = await computeDeclaredSha256Hex(file);
  const contentMd5Base64 = await computeContentMd5Base64(file);
  return { declaredSha256, contentMd5Base64 };
}

export const FILE_CONTENT_DIGEST_CHUNK_BYTES = CHUNK_SIZE;
