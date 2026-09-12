import { eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import type { KnowledgeVisibility } from "@/lib/knowledge/constants";
import type {
  ComparisonCandidateSnapshot,
  KnowledgeComparisonDetail,
} from "@/lib/knowledge/comparison-types";
import type { KnowledgeComparisonStoredResult } from "@/lib/knowledge/ai-comparison-schema";
import { canViewKnowledgeVisibility } from "@/lib/knowledge/visibility";
import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";

function normalizeVisibility(value: string): KnowledgeVisibility {
  return value === "restricted" || value === "owner" ? value : "team";
}

function canViewVersionSnapshot(
  context: KnowledgeSessionContext,
  input: {
    visibility: string;
    ownerUserId: string | null;
    articleStatus: string;
  },
): boolean {
  if (input.articleStatus === "archived" && context.role !== "knowledge_admin") {
    return false;
  }
  if (!context.role) return false;
  return canViewKnowledgeVisibility({
    role: context.role,
    visibility: normalizeVisibility(input.visibility),
    userId: context.user.id,
    ownerId: input.ownerUserId,
    hasRestrictedGrant: false,
  });
}

async function loadVersionAccessMap(
  context: KnowledgeSessionContext,
  articleVersionIds: string[],
  db: Database,
): Promise<Map<string, boolean>> {
  const uniqueIds = Array.from(new Set(articleVersionIds.filter(Boolean)));
  const access = new Map<string, boolean>();
  if (uniqueIds.length === 0) return access;

  const rows = await db
    .select({
      versionId: schema.knowledgeArticleVersions.id,
      visibility: schema.knowledgeArticleVersions.visibilitySnapshot,
      ownerUserId: schema.knowledgeArticleVersions.ownerUserIdSnapshot,
      articleStatus: schema.knowledgeArticles.status,
    })
    .from(schema.knowledgeArticleVersions)
    .innerJoin(
      schema.knowledgeArticles,
      eq(schema.knowledgeArticles.id, schema.knowledgeArticleVersions.articleId),
    )
    .where(inArray(schema.knowledgeArticleVersions.id, uniqueIds));

  for (const row of rows) {
    access.set(
      row.versionId,
      canViewVersionSnapshot(context, {
        visibility: row.visibility,
        ownerUserId: row.ownerUserId,
        articleStatus: row.articleStatus,
      }),
    );
  }
  return access;
}

function redactDiffItems<
  T extends {
    existingValue: string | null;
    existingExcerpt: string | null;
  },
>(items: T[], redactExisting: boolean): T[] {
  if (!redactExisting) return items;
  return items.map((item) => ({
    ...item,
    existingValue: null,
    existingExcerpt: null,
  }));
}

function redactComparisonPayload(
  comparison: KnowledgeComparisonStoredResult | null,
  redactExisting: boolean,
): KnowledgeComparisonStoredResult | null {
  if (!comparison || !redactExisting) return comparison;
  return {
    ...comparison,
    newFacts: redactDiffItems(comparison.newFacts, true),
    changedFacts: redactDiffItems(comparison.changedFacts, true),
    conflicts: redactDiffItems(comparison.conflicts, true),
    uncertainties: redactDiffItems(comparison.uncertainties, true),
    suggestedUpdates: comparison.suggestedUpdates,
  };
}

function redactCandidateSnapshot(
  snapshot: ComparisonCandidateSnapshot[],
  access: Map<string, boolean>,
): ComparisonCandidateSnapshot[] {
  return snapshot
    .filter((candidate) => access.get(candidate.articleVersionId) === true)
    .map((candidate) => ({ ...candidate }));
}

export async function redactKnowledgeComparisonForActor(
  context: KnowledgeSessionContext,
  detail: KnowledgeComparisonDetail,
  db: Database = getDb(),
): Promise<KnowledgeComparisonDetail> {
  const versionIds = [
    ...detail.candidateSnapshot.map((candidate) => candidate.articleVersionId),
    ...(detail.matchedArticleVersionId ? [detail.matchedArticleVersionId] : []),
  ];
  const access = await loadVersionAccessMap(context, versionIds, db);
  const matchedAccessible =
    detail.matchedArticleVersionId == null
      ? true
      : access.get(detail.matchedArticleVersionId) === true;

  const candidateSnapshot = redactCandidateSnapshot(
    detail.candidateSnapshot,
    access,
  );

  if (matchedAccessible) {
    return {
      ...detail,
      candidateSnapshot,
      comparison: redactComparisonPayload(detail.comparison, false),
    };
  }

  return {
    ...detail,
    matchedArticleId: null,
    matchedArticleVersionId: null,
    matchedVersionNumber: null,
    matchConfidence: null,
    candidateSnapshot,
    comparison: redactComparisonPayload(detail.comparison, true),
  };
}
