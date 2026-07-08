import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  AI_INSIGHT_FEEDBACK_REASON_TAGS,
  type AiInsightFeedback,
  type AiInsightFeedbackReasonTag,
} from "../../../../drizzle/schema/ai-insight-feedback";

export const AI_INSIGHT_FEEDBACK_MAX_COMMENT_LENGTH = 500;

export type AiInsightFeedbackView = {
  id: string;
  customerId: string;
  aiInsightId: string;
  insightGeneratedAt: string;
  model: string;
  promptVersion: string;
  sourceHash: string;
  rating: number;
  reasonTags: AiInsightFeedbackReasonTag[];
  comment: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type AiInsightFeedbackInput = {
  insightGeneratedAt: string;
  rating: number;
  reasonTags: string[];
  comment?: string | null;
};

export function formatAiInsightFeedback(row: AiInsightFeedback): AiInsightFeedbackView {
  let reasonTags: AiInsightFeedbackReasonTag[] = [];
  try {
    const parsed = JSON.parse(row.reasonTagsJson) as unknown;
    if (Array.isArray(parsed)) {
      reasonTags = parsed.filter((tag): tag is AiInsightFeedbackReasonTag =>
        AI_INSIGHT_FEEDBACK_REASON_TAGS.includes(tag as AiInsightFeedbackReasonTag),
      );
    }
  } catch {
    reasonTags = [];
  }

  return {
    id: row.id,
    customerId: row.customerId,
    aiInsightId: row.aiInsightId,
    insightGeneratedAt: row.insightGeneratedAt,
    model: row.model,
    promptVersion: row.promptVersion,
    sourceHash: row.sourceHash,
    rating: row.rating,
    reasonTags,
    comment: row.comment,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

export function isValidAiInsightFeedbackRating(rating: unknown): rating is number {
  return typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5;
}

export function normalizeAiInsightFeedbackReasonTags(
  reasonTags: unknown,
): AiInsightFeedbackReasonTag[] | null {
  if (!Array.isArray(reasonTags)) {
    return null;
  }

  const normalized: AiInsightFeedbackReasonTag[] = [];
  for (const tag of reasonTags) {
    if (typeof tag !== "string") {
      return null;
    }
    if (!AI_INSIGHT_FEEDBACK_REASON_TAGS.includes(tag as AiInsightFeedbackReasonTag)) {
      return null;
    }
    if (!normalized.includes(tag as AiInsightFeedbackReasonTag)) {
      normalized.push(tag as AiInsightFeedbackReasonTag);
    }
  }

  return normalized;
}

export function normalizeAiInsightFeedbackComment(comment: unknown): string | null {
  if (comment === undefined || comment === null || comment === "") {
    return null;
  }
  if (typeof comment !== "string") {
    return null;
  }
  const trimmed = comment.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > AI_INSIGHT_FEEDBACK_MAX_COMMENT_LENGTH) {
    return null;
  }
  return trimmed;
}

export async function getAiInsightFeedbackForInsight(
  db: Database,
  customerId: string,
  insightGeneratedAt: string,
): Promise<AiInsightFeedbackView | null> {
  const [row] = await db
    .select()
    .from(schema.aiInsightFeedback)
    .where(
      and(
        eq(schema.aiInsightFeedback.customerId, customerId),
        eq(schema.aiInsightFeedback.insightGeneratedAt, insightGeneratedAt),
      ),
    )
    .limit(1);

  return row ? formatAiInsightFeedback(row) : null;
}

export async function upsertAiInsightFeedbackRow(
  db: Database,
  params: {
    customerId: string;
    aiInsightId: string;
    insightGeneratedAt: string;
    model: string;
    promptVersion: string;
    sourceHash: string;
    rating: number;
    reasonTags: AiInsightFeedbackReasonTag[];
    comment: string | null;
    actorId: string;
    existingId?: string;
  },
): Promise<{ feedback: AiInsightFeedbackView; created: boolean }> {
  const now = new Date().toISOString();
  const reasonTagsJson = JSON.stringify(params.reasonTags);

  if (params.existingId) {
    await db
      .update(schema.aiInsightFeedback)
      .set({
        aiInsightId: params.aiInsightId,
        model: params.model,
        promptVersion: params.promptVersion,
        sourceHash: params.sourceHash,
        rating: params.rating,
        reasonTagsJson,
        comment: params.comment,
        updatedAt: now,
        updatedBy: params.actorId,
      })
      .where(eq(schema.aiInsightFeedback.id, params.existingId));

    const updated = await getAiInsightFeedbackForInsight(
      db,
      params.customerId,
      params.insightGeneratedAt,
    );
    if (!updated) {
      throw new Error("Failed to update AI insight feedback");
    }
    return { feedback: updated, created: false };
  }

  const id = crypto.randomUUID();
  await db.insert(schema.aiInsightFeedback).values({
    id,
    customerId: params.customerId,
    aiInsightId: params.aiInsightId,
    insightGeneratedAt: params.insightGeneratedAt,
    model: params.model,
    promptVersion: params.promptVersion,
    sourceHash: params.sourceHash,
    rating: params.rating,
    reasonTagsJson,
    comment: params.comment,
    createdBy: params.actorId,
    createdAt: now,
    updatedAt: now,
    updatedBy: null,
  });

  const created = await getAiInsightFeedbackForInsight(
    db,
    params.customerId,
    params.insightGeneratedAt,
  );
  if (!created) {
    throw new Error("Failed to create AI insight feedback");
  }
  return { feedback: created, created: true };
}

export function buildAiInsightFeedbackAuditMetadata(
  feedback: AiInsightFeedbackView,
): Record<string, string | number | string[]> {
  return {
    customerId: feedback.customerId,
    aiInsightId: feedback.aiInsightId,
    rating: feedback.rating,
    reasonTags: feedback.reasonTags,
    model: feedback.model,
    promptVersion: feedback.promptVersion,
    insightGeneratedAt: feedback.insightGeneratedAt,
    commentLength: feedback.comment?.length ?? 0,
  };
}
