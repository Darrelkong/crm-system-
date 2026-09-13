import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";

const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export const KNOWLEDGE_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
]);

export const JPEG_MIME_TYPES = new Set(["image/jpeg"]);
export const PNG_MIME_TYPES = new Set(["image/png"]);

function imageError(
  code: string,
  message: string,
): KnowledgeServiceError {
  return new KnowledgeServiceError(code, message, 400);
}

export function isKnowledgeImageExtension(extension: string): boolean {
  return KNOWLEDGE_IMAGE_EXTENSIONS.has(extension);
}

export function knowledgeImageMimeForExtension(
  extension: string,
): Set<string> | null {
  if (extension === ".jpg" || extension === ".jpeg") {
    return JPEG_MIME_TYPES;
  }
  if (extension === ".png") {
    return PNG_MIME_TYPES;
  }
  return null;
}

function hasMagic(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.byteLength < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

export function assertKnowledgeImageMagicBytes(
  bytes: ArrayBuffer,
  extension: string,
): void {
  const view = new Uint8Array(bytes);
  if (extension === ".jpg" || extension === ".jpeg") {
    if (!hasMagic(view, JPEG_MAGIC)) {
      throw imageError(
        KNOWLEDGE_ERROR_CODES.IMAGE_INVALID,
        "图片文件格式无效",
      );
    }
    return;
  }
  if (extension === ".png") {
    if (!hasMagic(view, PNG_MAGIC)) {
      throw imageError(
        KNOWLEDGE_ERROR_CODES.IMAGE_INVALID,
        "图片文件格式无效",
      );
    }
    return;
  }
  throw imageError(
    KNOWLEDGE_ERROR_CODES.IMAGE_UNSUPPORTED,
    "不支持此图片格式",
  );
}

export function normalizeKnowledgeImageMimeType(
  extension: string,
  mimeType: string | null | undefined,
): "image/jpeg" | "image/png" {
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  return "image/png";
}
