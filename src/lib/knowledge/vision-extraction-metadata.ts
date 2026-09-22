import type { KnowledgeVisionWarningCode } from "@/lib/knowledge/vision-types";

export const KNOWLEDGE_VISION_EXTRACTION_SCHEMA_VERSION =
  "knowledge-vision-extraction-v1" as const;

export type KnowledgeVisionExtractionQuality = "high" | "medium" | "low";

export type KnowledgeVisionMetadataWarning = {
  code: KnowledgeVisionWarningCode | string;
  message?: string;
};

export type KnowledgeVisionPageMetadata = {
  pageNumber: number;
  quality: KnowledgeVisionExtractionQuality;
  warnings: KnowledgeVisionMetadataWarning[];
};

export type KnowledgeVisionIntegrityTrace = {
  extractionModel: string | null;
  modelReportedQuality: KnowledgeVisionExtractionQuality;
  effectiveQuality: KnowledgeVisionExtractionQuality;
  requiresHumanReview: boolean;
  reasons: string[];
  highRiskFacts: string[];
};

export type KnowledgeVisionExtractionMetadata = {
  schemaVersion: typeof KNOWLEDGE_VISION_EXTRACTION_SCHEMA_VERSION;
  quality: KnowledgeVisionExtractionQuality;
  partial: boolean;
  pagesSucceeded: number;
  pagesTotal: number;
  warnings: KnowledgeVisionMetadataWarning[];
  pages: KnowledgeVisionPageMetadata[];
  integrityTrace?: KnowledgeVisionIntegrityTrace;
};

const METADATA_WARNING_MAX = 20;
const METADATA_MESSAGE_MAX = 300;

export function buildVisionExtractionMetadata(input: {
  quality: KnowledgeVisionExtractionQuality;
  warnings: KnowledgeVisionMetadataWarning[];
}): KnowledgeVisionExtractionMetadata {
  const warnings = input.warnings.slice(0, METADATA_WARNING_MAX).map((warning) => ({
    code: warning.code,
    message: warning.message?.slice(0, METADATA_MESSAGE_MAX),
  }));
  const quality =
    input.quality === "high" && warnings.length === 0
      ? "high"
      : input.quality;
  return {
    schemaVersion: KNOWLEDGE_VISION_EXTRACTION_SCHEMA_VERSION,
    quality,
    partial: false,
    pagesSucceeded: 1,
    pagesTotal: 1,
    warnings,
    pages: [
      {
        pageNumber: 1,
        quality,
        warnings,
      },
    ],
  };
}

export function parseVisionExtractionMetadata(
  value: string | null | undefined,
): KnowledgeVisionExtractionMetadata | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as KnowledgeVisionExtractionMetadata;
    if (parsed.schemaVersion !== KNOWLEDGE_VISION_EXTRACTION_SCHEMA_VERSION) {
      return null;
    }
    if (
      parsed.quality !== "high" &&
      parsed.quality !== "medium" &&
      parsed.quality !== "low"
    ) {
      return null;
    }
    if (
      typeof parsed.partial !== "boolean" ||
      typeof parsed.pagesSucceeded !== "number" ||
      typeof parsed.pagesTotal !== "number" ||
      !Array.isArray(parsed.warnings) ||
      !Array.isArray(parsed.pages)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function serializeVisionExtractionMetadata(
  metadata: KnowledgeVisionExtractionMetadata,
): string {
  return JSON.stringify(metadata);
}
