import { desc, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  AI_INSIGHT_FEEDBACK_REASON_TAGS,
  type AiInsightFeedbackReasonTag,
} from "../../../../drizzle/schema/ai-insight-feedback";
import { parseReasonTagsFromJson } from "@/lib/ai/customer-insights/feedback-stats-parse";

export type RatingDistribution = {
  "1": number;
  "2": number;
  "3": number;
  "4": number;
  "5": number;
};

export type AiInsightFeedbackStatsSummary = {
  totalCount: number;
  averageRating: number | null;
  helpfulCount: number;
  neutralCount: number;
  notHelpfulCount: number;
  ratingDistribution: RatingDistribution;
};

export type AiInsightFeedbackReasonTagRanking = {
  tag: AiInsightFeedbackReasonTag;
  count: number;
};

export type AiInsightFeedbackModelStats = {
  model: string;
  count: number;
  averageRating: number;
};

export type AiInsightFeedbackPromptVersionStats = {
  promptVersion: string;
  count: number;
  averageRating: number;
};

export type AiInsightFeedbackRecentItem = {
  id: string;
  customerId: string;
  customerName: string | null;
  rating: number;
  reasonTags: AiInsightFeedbackReasonTag[];
  model: string;
  promptVersion: string;
  insightGeneratedAt: string;
  commentLength: number;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
};

export type AiInsightFeedbackStatsResponse = {
  ok: true;
  summary: AiInsightFeedbackStatsSummary;
  reasonTagRankings: AiInsightFeedbackReasonTagRanking[];
  byModel: AiInsightFeedbackModelStats[];
  byPromptVersion: AiInsightFeedbackPromptVersionStats[];
  recent: AiInsightFeedbackRecentItem[];
};

export function emptyRatingDistribution(): RatingDistribution {
  return { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
}

export function roundAverageRating(value: number): number {
  return Math.round(value * 10) / 10;
}

export function buildSummaryFromRatings(ratings: number[]): AiInsightFeedbackStatsSummary {
  const ratingDistribution = emptyRatingDistribution();
  for (const rating of ratings) {
    if (rating >= 1 && rating <= 5) {
      const key = String(rating) as keyof RatingDistribution;
      ratingDistribution[key] += 1;
    }
  }

  const totalCount = ratings.length;
  const averageRating =
    totalCount === 0
      ? null
      : roundAverageRating(ratings.reduce((sum, rating) => sum + rating, 0) / totalCount);

  return {
    totalCount,
    averageRating,
    helpfulCount: ratings.filter((rating) => rating >= 4).length,
    neutralCount: ratings.filter((rating) => rating === 3).length,
    notHelpfulCount: ratings.filter((rating) => rating <= 2).length,
    ratingDistribution,
  };
}

export function buildSummaryFromDistribution(
  ratingDistribution: RatingDistribution,
): AiInsightFeedbackStatsSummary {
  const ratings: number[] = [];
  for (const [ratingKey, count] of Object.entries(ratingDistribution) as Array<
    [keyof RatingDistribution, number]
  >) {
    const rating = Number(ratingKey);
    for (let i = 0; i < count; i += 1) {
      ratings.push(rating);
    }
  }
  return buildSummaryFromRatings(ratings);
}

export function aggregateReasonTagRankings(
  reasonTagsJsonRows: string[],
): AiInsightFeedbackReasonTagRanking[] {
  const counts = new Map<AiInsightFeedbackReasonTag, number>();

  for (const row of reasonTagsJsonRows) {
    for (const tag of parseReasonTagsFromJson(row)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function roundGroupAverage(value: number): number {
  return roundAverageRating(value);
}

export async function getAiInsightFeedbackStats(
  db: Database,
): Promise<AiInsightFeedbackStatsResponse> {
  const ratingDistribution = emptyRatingDistribution();

  const ratingRows = await db
    .select({
      rating: schema.aiInsightFeedback.rating,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(schema.aiInsightFeedback)
    .groupBy(schema.aiInsightFeedback.rating);

  for (const row of ratingRows) {
    if (row.rating >= 1 && row.rating <= 5) {
      const key = String(row.rating) as keyof RatingDistribution;
      ratingDistribution[key] = row.count;
    }
  }

  const summary = buildSummaryFromDistribution(ratingDistribution);

  const reasonTagRows = await db
    .select({ reasonTagsJson: schema.aiInsightFeedback.reasonTagsJson })
    .from(schema.aiInsightFeedback);

  const reasonTagRankings = aggregateReasonTagRankings(
    reasonTagRows.map((row) => row.reasonTagsJson),
  );

  const modelRows = await db
    .select({
      model: schema.aiInsightFeedback.model,
      count: sql<number>`count(*)`.mapWith(Number),
      averageRating: sql<number>`avg(${schema.aiInsightFeedback.rating})`.mapWith(Number),
    })
    .from(schema.aiInsightFeedback)
    .groupBy(schema.aiInsightFeedback.model)
    .orderBy(desc(sql`count(*)`));

  const byModel: AiInsightFeedbackModelStats[] = modelRows.map((row) => ({
    model: row.model,
    count: row.count,
    averageRating: roundGroupAverage(row.averageRating),
  }));

  const promptVersionRows = await db
    .select({
      promptVersion: schema.aiInsightFeedback.promptVersion,
      count: sql<number>`count(*)`.mapWith(Number),
      averageRating: sql<number>`avg(${schema.aiInsightFeedback.rating})`.mapWith(Number),
    })
    .from(schema.aiInsightFeedback)
    .groupBy(schema.aiInsightFeedback.promptVersion)
    .orderBy(desc(sql`count(*)`));

  const byPromptVersion: AiInsightFeedbackPromptVersionStats[] = promptVersionRows.map(
    (row) => ({
      promptVersion: row.promptVersion,
      count: row.count,
      averageRating: roundGroupAverage(row.averageRating),
    }),
  );

  const recentRows = await db
    .select({
      id: schema.aiInsightFeedback.id,
      customerId: schema.aiInsightFeedback.customerId,
      customerName: schema.customers.customerName,
      rating: schema.aiInsightFeedback.rating,
      reasonTagsJson: schema.aiInsightFeedback.reasonTagsJson,
      model: schema.aiInsightFeedback.model,
      promptVersion: schema.aiInsightFeedback.promptVersion,
      insightGeneratedAt: schema.aiInsightFeedback.insightGeneratedAt,
      comment: schema.aiInsightFeedback.comment,
      createdAt: schema.aiInsightFeedback.createdAt,
      updatedAt: schema.aiInsightFeedback.updatedAt,
      createdByName: schema.users.displayName,
    })
    .from(schema.aiInsightFeedback)
    .leftJoin(
      schema.customers,
      eq(schema.aiInsightFeedback.customerId, schema.customers.id),
    )
    .leftJoin(schema.users, eq(schema.aiInsightFeedback.createdBy, schema.users.id))
    .orderBy(desc(schema.aiInsightFeedback.updatedAt))
    .limit(10);

  const recent: AiInsightFeedbackRecentItem[] = recentRows.map((row) => ({
    id: row.id,
    customerId: row.customerId,
    customerName: row.customerName,
    rating: row.rating,
    reasonTags: parseReasonTagsFromJson(row.reasonTagsJson),
    model: row.model,
    promptVersion: row.promptVersion,
    insightGeneratedAt: row.insightGeneratedAt,
    commentLength: row.comment?.length ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdByName: row.createdByName,
  }));

  return {
    ok: true,
    summary,
    reasonTagRankings,
    byModel,
    byPromptVersion,
    recent,
  };
}
