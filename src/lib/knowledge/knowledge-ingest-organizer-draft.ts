import type { Database } from "@/lib/db";
import { getDb } from "@/lib/db";
import type { KnowledgePasteBusinessIdentityJson } from "@/lib/knowledge/knowledge-paste-business-identity";
import type { KnowledgeSourceDetail } from "@/lib/knowledge/source-service";
import { getRequestedProjectItem } from "@/lib/constants/requested-projects";
import {
  type KnowledgeCategoryResolutionStatus,
  resolveKnowledgeCategoryForBusiness,
} from "@/lib/knowledge/knowledge-business-category-mapping-service";

export type OrganizerCategoryResolutionSource =
  | "explicit_mapping"
  | "manual"
  | null;

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
 * `requested_project_code`. Auto-fill uses explicit mapping rows only.
 */
export function resolveOrganizerKnowledgeCategoryId(input: {
  manualCategoryId: string | null;
  manualCategoryOverride: boolean;
  explicitMappingCategoryId?: string | null;
}): string {
  if (input.manualCategoryOverride && input.manualCategoryId) {
    return input.manualCategoryId;
  }
  if (input.explicitMappingCategoryId) {
    return input.explicitMappingCategoryId;
  }
  return "";
}

export async function buildOrganizerDraftFromOrganization(
  source: KnowledgeSourceDetail,
  options: {
    manualRequestedProjectCode: string | null;
    manualRequestedProjectOverride: boolean;
    manualCategoryId: string | null;
    manualCategoryOverride: boolean;
  },
  db?: Database,
): Promise<OrganizerDraftFields> {
  const organization = source.organization;
  if (!organization || organization.status !== "completed") {
    return emptyOrganizerDraft();
  }
  if (source.smartIngestScope.blocksSourceLevelOrganize) {
    return emptyOrganizerDraft();
  }

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
  let categoryResolutionSource: OrganizerCategoryResolutionSource = null;
  let categoryResolutionStatus: KnowledgeCategoryResolutionStatus | null = null;

  if (options.manualCategoryOverride && options.manualCategoryId) {
    categoryResolutionSource = "manual";
  } else if (requestedProjectCode) {
    const resolution = await resolveKnowledgeCategoryForBusiness(
      requestedProjectCode,
      db ?? getDb(),
    );
    categoryResolutionStatus = resolution.status;
    if (resolution.status === "matched" && resolution.categoryId) {
      explicitMappingCategoryId = resolution.categoryId;
      categoryResolutionSource = "explicit_mapping";
    }
  }

  return {
    title: organization.proposedTitle ?? "",
    summary: organization.proposedSummary ?? "",
    body: organization.proposedBody ?? "",
    requestedProjectCode,
    requestedProjectName: item?.canonicalZhHans ?? "",
    categoryId: resolveOrganizerKnowledgeCategoryId({
      manualCategoryId: options.manualCategoryId,
      manualCategoryOverride: options.manualCategoryOverride,
      explicitMappingCategoryId,
    }),
    categoryNotice,
    categoryResolutionSource,
    categoryResolutionStatus,
  };
}
