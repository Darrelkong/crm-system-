import type { KnowledgePasteBusinessIdentityJson } from "@/lib/knowledge/knowledge-paste-business-identity";
import type { KnowledgeSourceDetail } from "@/lib/knowledge/source-service";
import { getRequestedProjectItem } from "@/lib/constants/requested-projects";

export type OrganizerDraftFields = {
  title: string;
  summary: string;
  body: string;
  requestedProjectCode: string | null;
  requestedProjectName: string;
  categoryId: string;
  categoryNotice: "none" | "needs_confirmation" | "no_match";
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
 * `requested_project_code`. Future default mappings must use explicit config,
 * not display-name equality.
 */
export function resolveOrganizerKnowledgeCategoryId(input: {
  manualCategoryId: string | null;
  manualCategoryOverride: boolean;
}): string {
  if (input.manualCategoryOverride && input.manualCategoryId) {
    return input.manualCategoryId;
  }
  return "";
}

export function buildOrganizerDraftFromOrganization(
  source: KnowledgeSourceDetail,
  options: {
    manualRequestedProjectCode: string | null;
    manualRequestedProjectOverride: boolean;
    manualCategoryId: string | null;
    manualCategoryOverride: boolean;
  },
): OrganizerDraftFields {
  const organization = source.organization;
  if (!organization || organization.status !== "completed") {
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

  return {
    title: organization.proposedTitle ?? "",
    summary: organization.proposedSummary ?? "",
    body: organization.proposedBody ?? "",
    requestedProjectCode,
    requestedProjectName: item?.canonicalZhHans ?? "",
    categoryId: resolveOrganizerKnowledgeCategoryId({
      manualCategoryId: options.manualCategoryId,
      manualCategoryOverride: options.manualCategoryOverride,
    }),
    categoryNotice,
  };
}
