import type { Database } from "@/lib/db";
import { getDb } from "@/lib/db";
import type { KnowledgePasteBusinessIdentityJson } from "@/lib/knowledge/knowledge-paste-business-identity";
import type { KnowledgeSourceDetail } from "@/lib/knowledge/source-service";
import { getRequestedProjectItem } from "@/lib/constants/requested-projects";
import {
  type KnowledgeCategoryResolutionStatus,
  resolveKnowledgeCategoryForBusiness,
} from "@/lib/knowledge/knowledge-business-category-mapping-service";
import { suggestKnowledgeCategoryForOrganizer } from "@/lib/knowledge/knowledge-category-ai-suggestion-service";
import type { KnowledgeCategoryAiSuggestionResult } from "@/lib/knowledge/knowledge-category-ai-suggestion-schema";

export type OrganizerCategoryResolutionSource =
  | "explicit_mapping"
  | "ai_suggestion"
  | "manual"
  | null;

export type OrganizerCategoryAiSuggestion = {
  categoryId: string;
  categoryName: string;
};

export type OrganizerDraftFields = {
  title: string;
  summary: string;
  body: string;
  requestedProjectCode: string | null;
  requestedProjectName: string;
  categoryId: string;
  categoryNotice: "none" | "needs_confirmation" | "no_match";
  categoryResolutionSource: OrganizerCategoryResolutionSource;
  categoryResolutionStatus: KnowledgeCategoryResolutionStatus | null;
  categoryAiSuggestion: OrganizerCategoryAiSuggestion | null;
  categorySelectionRequired: boolean;
};

export function emptyOrganizerDraft(): OrganizerDraftFields {
  return {
    title: "",
    summary: "",
    body: "",
    requestedProjectCode: null,
    requestedProjectName: "",
    categoryId: "",
    categoryNotice: "none",
    categoryResolutionSource: null,
    categoryResolutionStatus: null,
    categoryAiSuggestion: null,
    categorySelectionRequired: false,
  };
}

export function resolveOrganizerRequestedProjectCode(input: {
  identity: KnowledgePasteBusinessIdentityJson | null;
  manualCode: string | null;
  manualOverride: boolean;
}): string | null {
  if (input.manualOverride && input.manualCode) {
    return input.manualCode;
  }
  if (
    input.identity?.categoryMatch === "confident" &&
    input.identity.requestedProjectCode
  ) {
    return input.identity.requestedProjectCode;
  }
  return input.identity?.requestedProjectCode ?? input.manualCode;
}

/**
 * Knowledge library category (`categoryId`) is independent from CRM
 * `requested_project_code`. Explicit mapping rows take priority over AI.
 */
export function resolveOrganizerKnowledgeCategoryId(input: {
  manualCategoryId: string | null;
  manualCategoryOverride: boolean;
  explicitMappingCategoryId?: string | null;
  aiPrefillCategoryId?: string | null;
}): string {
  if (input.manualCategoryOverride && input.manualCategoryId) {
    return input.manualCategoryId;
  }
  if (input.explicitMappingCategoryId) {
    return input.explicitMappingCategoryId;
  }
  if (input.aiPrefillCategoryId) {
    return input.aiPrefillCategoryId;
  }
  return "";
}

export type OrganizerDraftBuildDeps = {
  suggestCategory?: (context: {
    requestedProjectCode: string | null;
    requestedProjectLabel: string;
    title: string;
    summary: string;
    body: string;
  }) => Promise<KnowledgeCategoryAiSuggestionResult>;
};

export async function buildOrganizerDraftFromOrganization(
  source: KnowledgeSourceDetail,
  options: {
    manualRequestedProjectCode: string | null;
    manualRequestedProjectOverride: boolean;
    manualCategoryId: string | null;
    manualCategoryOverride: boolean;
  },
  db?: Database,
  deps?: OrganizerDraftBuildDeps,
): Promise<OrganizerDraftFields> {
  const organization = source.organization;
  if (!organization || organization.status !== "completed") {
    return emptyOrganizerDraft();
  }
  if (source.smartIngestScope.blocksSourceLevelOrganize) {
    return emptyOrganizerDraft();
  }

  const resolveDatabase = (): Database => db ?? getDb();
  const identity = organization.businessIdentity;
  const requestedProjectCode = resolveOrganizerRequestedProjectCode({
    identity,
    manualCode: options.manualRequestedProjectCode,
    manualOverride: options.manualRequestedProjectOverride,
  });
  const item = getRequestedProjectItem(requestedProjectCode);

  let categoryNotice: OrganizerDraftFields["categoryNotice"] = "none";
  if (identity?.categoryMatch === "needs_confirmation") {
    categoryNotice = "needs_confirmation";
  } else if (identity?.categoryMatch === "no_match") {
    categoryNotice = "no_match";
  }

  let explicitMappingCategoryId: string | null = null;
  let aiPrefillCategoryId: string | null = null;
  let categoryResolutionSource: OrganizerCategoryResolutionSource = null;
  let categoryResolutionStatus: KnowledgeCategoryResolutionStatus | null = null;
  let categoryAiSuggestion: OrganizerCategoryAiSuggestion | null = null;
  let categorySelectionRequired = false;

  if (options.manualCategoryOverride) {
    if (options.manualCategoryId) {
      categoryResolutionSource = "manual";
    }
  } else if (requestedProjectCode && !options.manualCategoryOverride) {
    const resolution = await resolveKnowledgeCategoryForBusiness(
      requestedProjectCode,
      resolveDatabase(),
    );
    categoryResolutionStatus = resolution.status;
    if (resolution.status === "matched" && resolution.categoryId) {
      explicitMappingCategoryId = resolution.categoryId;
      categoryResolutionSource = "explicit_mapping";
    }
  }

  const title = organization.proposedTitle ?? "";
  const summary = organization.proposedSummary ?? "";
  const body = organization.proposedBody ?? "";

  if (!explicitMappingCategoryId && !options.manualCategoryOverride) {
    const context = {
      requestedProjectCode,
      requestedProjectLabel: item?.canonicalZhHans ?? "",
      title,
      summary,
      body,
    };
    const aiResult = deps?.suggestCategory
      ? await deps.suggestCategory(context)
      : await suggestKnowledgeCategoryForOrganizer(context, resolveDatabase());
    if (
      aiResult.status === "suggested" &&
      aiResult.categoryId &&
      aiResult.categoryName
    ) {
      categoryResolutionSource = "ai_suggestion";
      if (aiResult.requiresConfirmation) {
        categoryAiSuggestion = {
          categoryId: aiResult.categoryId,
          categoryName: aiResult.categoryName,
        };
        categorySelectionRequired = true;
      } else {
        aiPrefillCategoryId = aiResult.categoryId;
      }
    } else if (
      aiResult.status === "insufficient_confidence" ||
      aiResult.status === "no_categories" ||
      aiResult.status === "invalid_output" ||
      aiResult.status === "error"
    ) {
      categorySelectionRequired = true;
    }
  }

  const categoryId = resolveOrganizerKnowledgeCategoryId({
    manualCategoryId: options.manualCategoryId,
    manualCategoryOverride: options.manualCategoryOverride,
    explicitMappingCategoryId,
    aiPrefillCategoryId,
  });

  if (!categoryId && !categoryAiSuggestion) {
    categorySelectionRequired = true;
  }

  return {
    title,
    summary,
    body,
    requestedProjectCode,
    requestedProjectName: item?.canonicalZhHans ?? "",
    categoryId,
    categoryNotice,
    categoryResolutionSource,
    categoryResolutionStatus,
    categoryAiSuggestion,
    categorySelectionRequired,
  };
}
