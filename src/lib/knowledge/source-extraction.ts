import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import { KNOWLEDGE_SOURCE_TEXT_MAX_CHARS } from "@/lib/knowledge/constants";
import {
  isMeaningfulKnowledgeSourceText,
  normalizeKnowledgeSourceText,
} from "@/lib/knowledge/source-text-normalization";

export type KnowledgeSourceExtractFormat =
  | "txt"
  | "markdown"
  | "docx"
  | "pdf";

export type KnowledgeSourceExtractionResult = {
  text: string;
  format: KnowledgeSourceExtractFormat;
  warnings: string[];
};

const PDF_MAGIC = "%PDF";
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;

function extractionError(
  code: string,
  message: string,
  status = 400,
): KnowledgeServiceError {
  return new KnowledgeServiceError(code, message, status);
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLocaleLowerCase() : "";
}

function assertMaxExtractedText(text: string): void {
  if (text.length > KNOWLEDGE_SOURCE_TEXT_MAX_CHARS) {
    throw extractionError(
      KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_TOO_LARGE,
      "提取后的文字超过允许长度",
    );
  }
}

function hasZipMagic(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((byte, index) => bytes[index] === byte);
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PDF_MAGIC.length) return false;
  const header = new TextDecoder("ascii").decode(bytes.slice(0, PDF_MAGIC.length));
  return header === PDF_MAGIC;
}

function decodeUtf8Text(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw extractionError(
      KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_FAILED,
      "文件文字提取失败",
    );
  }
}

function finalizeExtractedText(
  text: string,
  format: KnowledgeSourceExtractFormat,
  warnings: string[] = [],
): KnowledgeSourceExtractionResult {
  const normalized = normalizeKnowledgeSourceText(text);
  if (!isMeaningfulKnowledgeSourceText(normalized)) {
    throw extractionError(
      KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_FAILED,
      "无法从文件取得合适的文字内容",
    );
  }
  assertMaxExtractedText(normalized);
  return { text: normalized, format, warnings };
}

async function extractDocxText(bytes: ArrayBuffer): Promise<string> {
  const view = new Uint8Array(bytes);
  if (!hasZipMagic(view)) {
    throw extractionError(
      KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_FAILED,
      "DOCX 文件格式无效",
    );
  }
  try {
    const result = await mammoth.extractRawText({
      buffer: Buffer.from(bytes),
    });
    return result.value;
  } catch {
    throw extractionError(
      KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_FAILED,
      "DOCX 文件无法读取",
    );
  }
}

function mapPdfExtractionError(error: unknown): KnowledgeServiceError {
  const message =
    error instanceof Error ? error.message.toLocaleLowerCase() : String(error);
  if (
    message.includes("password") ||
    message.includes("encrypted") ||
    message.includes("needs password")
  ) {
    return extractionError(
      KNOWLEDGE_ERROR_CODES.PDF_PASSWORD_PROTECTED,
      "此 PDF 已加密或需要密码",
    );
  }
  return extractionError(
    KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_FAILED,
    "PDF 文件无法读取",
  );
}

async function extractPdfText(bytes: ArrayBuffer): Promise<string> {
  const view = new Uint8Array(bytes);
  if (!hasPdfMagic(view)) {
    throw extractionError(
      KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_FAILED,
      "PDF 文件格式无效",
    );
  }
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes.slice(0)));
    const { text, totalPages } = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];
    const combined = pages
      .map((page) => normalizeKnowledgeSourceText(page))
      .filter(Boolean)
      .join("\n\n");
    if (!isMeaningfulKnowledgeSourceText(combined)) {
      throw extractionError(
        KNOWLEDGE_ERROR_CODES.SCANNED_PDF_UNSUPPORTED,
        "此 PDF 没有可读取的文字层",
      );
    }
    if (totalPages > 0 && pages.every((page) => !normalizeKnowledgeSourceText(page))) {
      throw extractionError(
        KNOWLEDGE_ERROR_CODES.SCANNED_PDF_UNSUPPORTED,
        "此 PDF 没有可读取的文字层",
      );
    }
    return combined;
  } catch (error) {
    if (error instanceof KnowledgeServiceError) throw error;
    throw mapPdfExtractionError(error);
  }
}

export async function extractKnowledgeSourceText(input: {
  bytes: ArrayBuffer;
  filename: string;
  mimeType?: string | null;
}): Promise<KnowledgeSourceExtractionResult> {
  const extension = extensionOf(input.filename);
  switch (extension) {
    case ".txt": {
      const decoded = decodeUtf8Text(input.bytes);
      return finalizeExtractedText(decoded, "txt");
    }
    case ".md": {
      const decoded = decodeUtf8Text(input.bytes);
      return finalizeExtractedText(decoded, "markdown");
    }
    case ".docx": {
      const extracted = await extractDocxText(input.bytes);
      return finalizeExtractedText(extracted, "docx");
    }
    case ".pdf": {
      const extracted = await extractPdfText(input.bytes);
      return finalizeExtractedText(extracted, "pdf");
    }
    default:
      throw extractionError(
        KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_UNAVAILABLE,
        "此文件格式目前无法安全提取文字",
      );
  }
}

/** @deprecated Use extractKnowledgeSourceText — kept for gradual test migration. */
export function extractKnowledgeText(
  bytes: ArrayBuffer,
  extension: string,
): { text: string; status: "ready" } {
  if (extension !== ".txt" && extension !== ".md") {
    throw extractionError(
      KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_UNAVAILABLE,
      "此文件格式目前无法安全提取文字",
    );
  }
  const decoded = decodeUtf8Text(bytes);
  const normalized = normalizeKnowledgeSourceText(decoded);
  if (!isMeaningfulKnowledgeSourceText(normalized)) {
    throw extractionError(
      KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_FAILED,
      "无法从文件取得合适的文字内容",
    );
  }
  assertMaxExtractedText(normalized);
  return { text: normalized, status: "ready" };
}
