/**
 * Server-authoritative snapshot resolver for component feedback.
 * Never trust client-supplied snapshot fields.
 */

import { and, desc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import type { User } from "../../../../drizzle/schema/users";
import type { CustomerAiInsightView } from "@/lib/ai/customer-insights/service";
import {
  createFeedbackSnapshotInput,
  type AiInsightFeedbackActorRoleSnapshot,
  type AiInsightFeedbackContractModeSnapshot,
  type AiInsightFeedbackProviderSnapshot,
  type AiInsightFeedbackSnapshotInput,
} from "@/lib/ai/customer-insights/feedback-contract";
import { resolveAiProviderPhase2ContractMode } from "@/lib/ai/customer-insights/provider-contract-mode";
import { resolvePhase2GeneratedSnapshot } from "@/lib/ai/customer-insights/feedback-component-eligibility";

const PROVIDER_ALLOWLIST = new Set<string>([
  "google_gemini",
  "openai_compatible",
  "mock",
  "unknown",
]);

type RefreshAuditMeta = {
  customerId?: unknown;
  providerKind?: unknown;
  phase2Generated?: unknown;
  phase2UnavailableReason?: unknown;
  sourceHash?: unknown;
  /** Optional generation reference when present in newer audit metadata. */
  generatedAt?: unknown;
};

/**
 * Bounded lookup: only successful refresh audits for this customer (limit 25).
 * Exact match on sourceHash; also require generatedAt when metadata includes it.
 * Never uses failed-refresh events, latest-only heuristics, or cross-customer rows.
 */
async function findMatchingRefreshAuditMeta(
  db: Database,
  customerId: string,
  sourceHash: string,
  insightGeneratedAt: string,
): Promise<RefreshAuditMeta | null> {
  const rows = await db
    .select({
      metadata: schema.auditLogs.metadata,
      createdAt: schema.auditLogs.createdAt,
    })
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.action, "customer.ai_insight.refreshed"),
        eq(schema.auditLogs.entityType, "customer"),
        eq(schema.auditLogs.entityId, customerId),
      ),
    )
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(25);

  for (const row of rows) {
    if (!row.metadata) continue;
    try {
      const parsed = JSON.parse(row.metadata) as RefreshAuditMeta;
      if (
        typeof parsed.customerId === "string" &&
        parsed.customerId !== customerId
      ) {
        continue;
      }
      if (
        typeof parsed.sourceHash !== "string" ||
        parsed.sourceHash !== sourceHash
      ) {
        continue;
      }
      if (
        typeof parsed.generatedAt === "string" &&
        parsed.generatedAt !== insightGeneratedAt
      ) {
        continue;
      }
      return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

function toProviderSnapshot(value: unknown): AiInsightFeedbackProviderSnapshot {
  if (typeof value === "string" && PROVIDER_ALLOWLIST.has(value)) {
    return value as AiInsightFeedbackProviderSnapshot;
  }
  return "unknown";
}

function toActorRoleSnapshot(role: User["role"]): AiInsightFeedbackActorRoleSnapshot {
  return role === "admin" ? "admin" : "staff";
}

/**
 * Builds snapshots for the current ready insight generation.
 * Provider/contract prefer exact refresh-audit match by sourceHash;
 * otherwise use legal `unknown` (Foundation allows unknown for new rows).
 */
export async function resolveComponentFeedbackSnapshots(
  db: Database,
  user: User,
  insight: CustomerAiInsightView,
): Promise<AiInsightFeedbackSnapshotInput> {
  const audit = await findMatchingRefreshAuditMeta(
    db,
    insight.customerId,
    insight.sourceHash,
    insight.generatedAt,
  );

  const providerSnapshot = toProviderSnapshot(audit?.providerKind);
  const contractModeSnapshot: AiInsightFeedbackContractModeSnapshot =
    providerSnapshot === "unknown"
      ? "unknown"
      : resolveAiProviderPhase2ContractMode(providerSnapshot);

  const phase2GeneratedSnapshot = resolvePhase2GeneratedSnapshot(insight);

  let degradationReasonSnapshot: string | null = null;
  if (
    !phase2GeneratedSnapshot &&
    typeof audit?.phase2UnavailableReason === "string" &&
    audit.phase2UnavailableReason.trim() !== ""
  ) {
    degradationReasonSnapshot = audit.phase2UnavailableReason.trim();
  }

  const snapshots = createFeedbackSnapshotInput({
    providerSnapshot,
    modelSnapshot: insight.model,
    promptVersionSnapshot: insight.promptVersion,
    contractModeSnapshot,
    phase2GeneratedSnapshot,
    actorRoleSnapshot: toActorRoleSnapshot(user.role),
    degradationReasonSnapshot,
  });

  if (!snapshots) {
    throw new Error("Failed to build server-authoritative feedback snapshots");
  }
  return snapshots;
}
