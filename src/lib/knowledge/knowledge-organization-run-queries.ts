import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import type { KnowledgeAiOrganizationRun } from "../../../drizzle/schema/knowledge-ai-organization-runs";
import { parseKnowledgePasteBusinessIdentityJson } from "@/lib/knowledge/knowledge-paste-business-identity";
import type { KnowledgeSourceDetail } from "@/lib/knowledge/source-service";

export function mapOrganizationRun(
  run: KnowledgeAiOrganizationRun | null,
): KnowledgeSourceDetail["organization"] {
  if (!run) return null;
  let warnings: string[] = [];
  if (run.warningsJson) {
    try {
      const parsed = JSON.parse(run.warningsJson) as unknown;
      if (Array.isArray(parsed)) {
        warnings = parsed.filter((value): value is string => typeof value === "string");
      }
    } catch {
      warnings = [];
    }
  }
  return {
    id: run.id,
    status: run.status,
    provider: run.provider,
    model: run.model,
    proposedTitle: run.proposedTitle,
    proposedSummary: run.proposedSummary,
    proposedBody: run.proposedBody,
    proposedCategory: run.proposedCategory,
    businessIdentity: parseKnowledgePasteBusinessIdentityJson(
      run.businessIdentityJson,
    ),
    warnings,
    failureCode: run.failureCode,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  };
}

export async function latestSourceLevelOrganization(
  sourceId: string,
  db: Database,
): Promise<KnowledgeAiOrganizationRun | null> {
  return (
    await db
      .select()
      .from(schema.knowledgeAiOrganizationRuns)
      .where(
        and(
          eq(schema.knowledgeAiOrganizationRuns.sourceId, sourceId),
          isNull(schema.knowledgeAiOrganizationRuns.candidateId),
        ),
      )
      .orderBy(desc(schema.knowledgeAiOrganizationRuns.createdAt), sql`knowledge_ai_organization_runs.rowid DESC`)
      .limit(1)
  )[0] ?? null;
}

export async function latestCandidateOrganization(
  candidateId: string,
  db: Database,
): Promise<KnowledgeAiOrganizationRun | null> {
  return (
    await db
      .select()
      .from(schema.knowledgeAiOrganizationRuns)
      .where(eq(schema.knowledgeAiOrganizationRuns.candidateId, candidateId))
      .orderBy(desc(schema.knowledgeAiOrganizationRuns.createdAt), sql`knowledge_ai_organization_runs.rowid DESC`)
      .limit(1)
  )[0] ?? null;
}

export async function getActiveSourceLevelOrganizationRun(
  sourceId: string,
  db: Database,
): Promise<KnowledgeAiOrganizationRun | null> {
  return (
    await db
      .select()
      .from(schema.knowledgeAiOrganizationRuns)
      .where(
        and(
          eq(schema.knowledgeAiOrganizationRuns.sourceId, sourceId),
          isNull(schema.knowledgeAiOrganizationRuns.candidateId),
          inArray(schema.knowledgeAiOrganizationRuns.status, [
            "pending",
            "processing",
          ]),
        ),
      )
      .limit(1)
  )[0] ?? null;
}

export async function getActiveCandidateOrganizationRun(
  candidateId: string,
  db: Database,
): Promise<KnowledgeAiOrganizationRun | null> {
  return (
    await db
      .select()
      .from(schema.knowledgeAiOrganizationRuns)
      .where(
        and(
          eq(schema.knowledgeAiOrganizationRuns.candidateId, candidateId),
          inArray(schema.knowledgeAiOrganizationRuns.status, [
            "pending",
            "processing",
          ]),
        ),
      )
      .limit(1)
  )[0] ?? null;
}
