import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import type { KnowledgeSourceListItem } from "@/lib/knowledge/source-service";

export function formatSelectedFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatFileTypeLabel(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  switch (extension) {
    case "docx":
      return "DOCX";
    case "pdf":
      return "PDF";
    case "md":
      return "Markdown";
    case "txt":
      return "TXT";
    case "jpg":
    case "jpeg":
      return "JPG";
    case "png":
      return "PNG";
    default:
      return extension ? extension.toUpperCase() : "File";
  }
}

export function formatFileTypeFromSource(
  mimeType: string | null,
  originalFilename: string | null,
): string | null {
  if (originalFilename) {
    return formatFileTypeLabel(originalFilename);
  }
  if (!mimeType) return null;
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("pdf")) return "PDF";
  if (normalized.includes("wordprocessingml")) return "DOCX";
  if (normalized.includes("markdown")) return "Markdown";
  if (normalized.includes("text/plain")) return "TXT";
  if (normalized.includes("image/jpeg")) return "JPG";
  if (normalized.includes("image/png")) return "PNG";
  return null;
}

export function isKnowledgeImageFilename(filename: string): boolean {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return extension === "jpg" || extension === "jpeg" || extension === "png";
}

export function visionExtractionAdvisoryKey(
  metadata: {
    quality: "high" | "medium" | "low";
    warnings: Array<{ code: string; message?: string }>;
    integrityTrace?: {
      requiresHumanReview: boolean;
      extractionUsable?: boolean;
    } | null;
  } | null,
): "complete" | "review" | "unusable" | null {
  if (!metadata) return null;
  if (metadata.integrityTrace?.extractionUsable === false) {
    return "unusable";
  }
  if (metadata.integrityTrace?.requiresHumanReview) {
    return "review";
  }
  if (
    metadata.quality === "high" &&
    metadata.warnings.length === 0
  ) {
    return "complete";
  }
  return "review";
}

export function formatSourceSizeBytes(sizeBytes: number | null): string | null {
  if (sizeBytes == null || sizeBytes <= 0) return null;
  return formatSelectedFileSize(sizeBytes);
}

export function buildFileSourceMetaLine(
  mimeType: string | null,
  originalFilename: string | null,
  sizeBytes: number | null,
): string | null {
  const typeLabel = formatFileTypeFromSource(mimeType, originalFilename);
  const sizeLabel = formatSourceSizeBytes(sizeBytes);
  if (typeLabel && sizeLabel) return `${typeLabel} · ${sizeLabel}`;
  return typeLabel ?? sizeLabel;
}

export function isFileUploadSource(source: KnowledgeSourceListItem): boolean {
  return source.sourceType === "file";
}

export function isScannedPdfFailure(failureCode: string | null): boolean {
  return failureCode === KNOWLEDGE_ERROR_CODES.SCANNED_PDF_UNSUPPORTED;
}

export function isExtractionFailureStatus(
  status: KnowledgeSourceListItem["status"],
): boolean {
  return status === "failed";
}
