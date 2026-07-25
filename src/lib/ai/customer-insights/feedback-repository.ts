/**
 * Phase 5D-1 component feedback repository (not wired to routes yet).
 */

import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  createFeedbackSnapshotInput,
  normalizeFeedbackTags,
  serializeFeedbackTags,
  type AiInsightFeedbackComponentTarget,
  type AiInsightFeedbackRatingCode,
  type AiInsightFeedbackSnapshotInput,
  type AiInsightFeedbackComponentTag,
} from "@/lib/ai/customer-insights/feedback-contract";
import { buildAiInsightGenerationKey } from "@/lib/ai/customer-insights/feedback-generation-key";

export type ComponentFeedbackView = {
  id: string;
  customerId: string;
  aiInsightId: string;
  insightGeneratedAt: string;
  sourceHash: string;
  generationKey: string;
  feedbackTarget: AiInsightFeedbackComponentTarget;
  ratingCode: AiInsightFeedbackRatingCode;
  reasonTags: AiInsightFeedbackComponentTag[];
  comment: null;
  model: string;
  promptVersion: string;
  providerSnapshot: string;
  contractModeSnapshot: string;
  phase2GeneratedSnapshot: boolean;
  actorRoleSnapshot: string;
  degradationReasonSnapshot: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type UpsertActorComponentFeedbackInput = {
  customerId: string;
  aiInsightId: string;
  insightGeneratedAt: string;
  sourceHash: string;
  /** Authoritative model for the generation (also stored as modelSnapshot). */
  model: string;
  promptVersion: string;
  feedbackTarget: AiInsightFeedbackComponentTarget;
  ratingCode: AiInsightFeedbackRatingCode;
  tags: readonly string[];
  snapshots: AiInsightFeedbackSnapshotInput;
  actorUserId: string;
};

export class FeedbackRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedbackRepositoryError";
  }
}

function formatComponentRow(
  row: typeof schema.aiInsightFeedback.$inferSelect,
): ComponentFeedbackView {
  if (
    row.feedbackTarget === "legacy_overall" ||
    row.generationKey == null ||
    row.ratingCode == null ||
    row.phase2GeneratedSnapshot == null ||
    row.providerSnapshot == null ||
    row.contractModeSnapshot == null ||
    row.actorRoleSnapshot == null
  ) {
    throw new FeedbackRepositoryError("Row is not a component feedback record");
  }

  let reasonTags: AiInsightFeedbackComponentTag[] = [];
  try {
    const parsed = JSON.parse(row.reasonTagsJson) as unknown;
    if (Array.isArray(parsed)) {
      reasonTags = parsed.filter((tag): tag is AiInsightFeedbackComponentTag =>
        typeof tag === "string",
      ) as AiInsightFeedbackComponentTag[];
    }
  } catch {
    reasonTags = [];
  }

  return {
    id: row.id,
    customerId: row.customerId,
    aiInsightId: row.aiInsightId,
    insightGeneratedAt: row.insightGeneratedAt,
    sourceHash: row.sourceHash,
    generationKey: row.generationKey,
    feedbackTarget: row.feedbackTarget,
    ratingCode: row.ratingCode,
    reasonTags,
    comment: null,
    model: row.model,
    promptVersion: row.promptVersion,
    providerSnapshot: row.providerSnapshot,
    contractModeSnapshot: row.contractModeSnapshot,
    phase2GeneratedSnapshot: row.phase2GeneratedSnapshot,
    actorRoleSnapshot: row.actorRoleSnapshot,
    degradationReasonSnapshot: row.degradationReasonSnapshot,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

export async function getActorFeedbackForGeneration(
  db: Database,
  params: {
    generationKey: string;
    actorUserId: string;
    feedbackTarget: AiInsightFeedbackComponentTarget;
  },
): Promise<ComponentFeedbackView | null> {
  const [row] = await db
    .select()
    .from(schema.aiInsightFeedback)
    .where(
      and(
        eq(schema.aiInsightFeedback.generationKey, params.generationKey),
        eq(schema.aiInsightFeedback.createdBy, params.actorUserId),
        eq(schema.aiInsightFeedback.feedbackTarget, params.feedbackTarget),
      ),
    )
    .limit(1);

  if (!row || row.feedbackTarget === "legacy_overall") {
    return null;
  }
  return formatComponentRow(row);
}

export async function listFeedbackForGeneration(
  db: Database,
  generationKey: string,
): Promise<ComponentFeedbackView[]> {
  const rows = await db
    .select()
    .from(schema.aiInsightFeedback)
    .where(eq(schema.aiInsightFeedback.generationKey, generationKey));

  return rows
    .filter((row) => row.feedbackTarget !== "legacy_overall")
    .map((row) => formatComponentRow(row));
}

/**
 * Upsert component feedback for one actor × generation × target.
 * Snapshots must be server-authoritative (never trust client snapshot payloads).
 * Does not modify Insight or Customer rows. Does not call providers.
 * Comment is always NULL for new component feedback.
 */
export async function upsertActorComponentFeedback(
  db: Database,
  input: UpsertActorComponentFeedbackInput,
): Promise<{ feedback: ComponentFeedbackView; created: boolean }> {
  const snapshots = createFeedbackSnapshotInput(input.snapshots);
  if (!snapshots) {
    throw new FeedbackRepositoryError("Invalid feedback snapshots");
  }
  if (snapshots.modelSnapshot !== input.model.trim()) {
    throw new FeedbackRepositoryError("model snapshot must match generation model");
  }
  if (snapshots.promptVersionSnapshot !== input.promptVersion.trim()) {
    throw new FeedbackRepositoryError(
      "promptVersion snapshot must match generation promptVersion",
    );
  }

  const tags = normalizeFeedbackTags(input.feedbackTarget, [...input.tags]);
  if (tags === null) {
    throw new FeedbackRepositoryError("Invalid feedback tags for target");
  }

  const generationKey = buildAiInsightGenerationKey({
    aiInsightId: input.aiInsightId,
    insightGeneratedAt: input.insightGeneratedAt,
    sourceHash: input.sourceHash,
  });

  const existing = await getActorFeedbackForGeneration(db, {
    generationKey,
    actorUserId: input.actorUserId,
    feedbackTarget: input.feedbackTarget,
  });

  const now = new Date().toISOString();
  const reasonTagsJson = serializeFeedbackTags(tags);

  if (existing) {
    await db
      .update(schema.aiInsightFeedback)
      .set({
        rating: null,
        ratingCode: input.ratingCode,
        reasonTagsJson,
        comment: null,
        model: input.model.trim(),
        promptVersion: input.promptVersion.trim(),
        providerSnapshot: snapshots.providerSnapshot,
        contractModeSnapshot: snapshots.contractModeSnapshot,
        phase2GeneratedSnapshot: snapshots.phase2GeneratedSnapshot,
        actorRoleSnapshot: snapshots.actorRoleSnapshot,
        degradationReasonSnapshot: snapshots.degradationReasonSnapshot ?? null,
        updatedAt: now,
        updatedBy: input.actorUserId,
      })
      .where(eq(schema.aiInsightFeedback.id, existing.id));

    const updated = await getActorFeedbackForGeneration(db, {
      generationKey,
      actorUserId: input.actorUserId,
      feedbackTarget: input.feedbackTarget,
    });
    if (!updated) {
      throw new FeedbackRepositoryError("Failed to update component feedback");
    }
    return { feedback: updated, created: false };
  }

  const id = crypto.randomUUID();
  await db.insert(schema.aiInsightFeedback).values({
    id,
    customerId: input.customerId,
    aiInsightId: input.aiInsightId,
    insightGeneratedAt: input.insightGeneratedAt,
    model: input.model.trim(),
    promptVersion: input.promptVersion.trim(),
    sourceHash: input.sourceHash.trim(),
    rating: null,
    reasonTagsJson,
    comment: null,
    createdBy: input.actorUserId,
    createdAt: now,
    updatedAt: now,
    updatedBy: null,
    generationKey,
    feedbackTarget: input.feedbackTarget,
    ratingCode: input.ratingCode,
    providerSnapshot: snapshots.providerSnapshot,
    contractModeSnapshot: snapshots.contractModeSnapshot,
    phase2GeneratedSnapshot: snapshots.phase2GeneratedSnapshot,
    actorRoleSnapshot: snapshots.actorRoleSnapshot,
    degradationReasonSnapshot: snapshots.degradationReasonSnapshot ?? null,
  });

  const created = await getActorFeedbackForGeneration(db, {
    generationKey,
    actorUserId: input.actorUserId,
    feedbackTarget: input.feedbackTarget,
  });
  if (!created) {
    throw new FeedbackRepositoryError("Failed to create component feedback");
  }
  return { feedback: created, created: true };
}
