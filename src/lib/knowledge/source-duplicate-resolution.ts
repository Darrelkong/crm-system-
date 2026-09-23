import { isKnowledgeImageFilename } from "@/lib/knowledge/source-image-validation";
import {
  isVisionExtractionUsable,
  sourceBlocksOrganizeForVisionReview,
  sourceRequiresVisionHumanReview,
  visionExtractionReviewConfirmed,
} from "@/lib/knowledge/knowledge-vision-integrity";
import type { KnowledgeSourceDuplicateSummary } from "@/lib/knowledge/source-duplicate";
import type { KnowledgeSourceStatus } from "../../../drizzle/schema/knowledge-sources";
import {
  KNOWLEDGE_VISION_EXTRACTION_SCHEMA_VERSION,
  parseVisionExtractionMetadata,
  type KnowledgeVisionExtractionMetadata,
} from "@/lib/knowledge/vision-extraction-metadata";

export type DuplicateResolutionCase =
  | "archived"
  | "failed_extraction"
  | "unusable"
  | "awaiting_review"
  | "completed";

export type KnowledgeSourceDuplicateResolution = {
  case: DuplicateResolutionCase;
  canReprocess: boolean;
  canContinueReview: boolean;
  requiresReprocessConfirmation: boolean;
};

function isVisionImageFileSource(input: {
  sourceType: string;
  originalFilename: string | null;
  storageKey: string | null;
}): boolean {
  return (
    input.sourceType === "file" &&
    Boolean(input.storageKey) &&
    Boolean(
      input.originalFilename &&
        isKnowledgeImageFilename(input.originalFilename),
    )
  );
}

export function isExtractionMetadataStale(
  metadata: KnowledgeVisionExtractionMetadata | null,
): boolean {
  if (!metadata) return true;
  if (metadata.schemaVersion !== KNOWLEDGE_VISION_EXTRACTION_SCHEMA_VERSION) {
    return true;
  }
  if (metadata.integrityTrace?.extractionUsable === undefined) {
    return true;
  }
  return false;
}

export function assessKnowledgeDuplicateResolution(input: {
  status: KnowledgeSourceStatus;
  archivedAt: string | null;
  sourceType: string;
  originalFilename: string | null;
  storageKey: string | null;
  extractionMethod: string | null;
  extractionMetadataJson: string | null;
  rawText: string | null;
  linkedArticleId: string | null;
}): KnowledgeSourceDuplicateResolution {
  if (input.archivedAt) {
    return {
      case: "archived",
      canReprocess: false,
      canContinueReview: false,
      requiresReprocessConfirmation: false,
    };
  }

  const metadata = parseVisionExtractionMetadata(input.extractionMetadataJson);
  const visionImage = isVisionImageFileSource(input);

  if (input.linkedArticleId || input.status === "converted") {
    return {
      case: "completed",
      canReprocess: false,
      canContinueReview: false,
      requiresReprocessConfirmation: false,
    };
  }

  if (input.status === "failed" && visionImage) {
    return {
      case: "failed_extraction",
      canReprocess: true,
      canContinueReview: false,
      requiresReprocessConfirmation: false,
    };
  }

  if (!visionImage) {
    return {
      case: "completed",
      canReprocess: false,
      canContinueReview: false,
      requiresReprocessConfirmation: false,
    };
  }

  if (input.extractionMethod === "vision") {
    const usable = isVisionExtractionUsable({
      extractionMethod: input.extractionMethod,
      extractionMetadata: metadata,
      rawText: input.rawText,
    });
    if (!usable) {
      return {
        case: "unusable",
        canReprocess: true,
        canContinueReview: false,
        requiresReprocessConfirmation: false,
      };
    }

    const confirmed = visionExtractionReviewConfirmed(metadata);
    const awaitingReview = sourceBlocksOrganizeForVisionReview({
      extractionMethod: input.extractionMethod,
      extractionMetadata: metadata,
      rawText: input.rawText,
    });
    const stale = isExtractionMetadataStale(metadata);

    if (!confirmed && (awaitingReview || stale)) {
      return {
        case: "awaiting_review",
        canReprocess: true,
        canContinueReview: true,
        requiresReprocessConfirmation: false,
      };
    }

    if (confirmed || input.status === "organized") {
      return {
        case: "completed",
        canReprocess: true,
        canContinueReview: false,
        requiresReprocessConfirmation: true,
      };
    }
  }

  if (
    sourceRequiresVisionHumanReview({
      extractionMethod: input.extractionMethod,
      extractionMetadata: metadata,
      rawText: input.rawText,
    }) &&
    !visionExtractionReviewConfirmed(metadata)
  ) {
    return {
      case: "awaiting_review",
      canReprocess: true,
      canContinueReview: true,
      requiresReprocessConfirmation: false,
    };
  }

  return {
    case: "completed",
    canReprocess: false,
    canContinueReview: false,
    requiresReprocessConfirmation: false,
  };
}

export type KnowledgeSourceDuplicateNotice = KnowledgeSourceDuplicateSummary &
  KnowledgeSourceDuplicateResolution;

export function buildDuplicateNoticeFromSource(source: {
  id: string;
  sourceTitle: string | null;
  originalFilename: string | null;
  status: KnowledgeSourceStatus;
  archivedAt: string | null;
  createdAt: string;
  sourceType: string;
  storageKey: string | null;
  extractionMethod: string | null;
  extractionMetadataJson: string | null;
  rawText: string | null;
  linkedArticleId: string | null;
}): KnowledgeSourceDuplicateNotice {
  const resolution = assessKnowledgeDuplicateResolution(source);
  return {
    id: source.id,
    sourceTitle: source.sourceTitle,
    originalFilename: source.originalFilename,
    status: source.status,
    lifecycle: source.archivedAt ? "archived" : "active",
    createdAt: source.createdAt,
    ...resolution,
  };
}
