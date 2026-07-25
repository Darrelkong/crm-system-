import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { customerAiInsights } from "./customer-ai-insights";
import { customers } from "./customers";
import { users } from "./users";

/** Legacy overall-feedback reason tags (pre–Phase 5D). Kept for existing rows/API. */
export const AI_INSIGHT_FEEDBACK_REASON_TAGS = [
  "inaccurate_intent",
  "next_action_too_generic",
  "robotic_message",
  "missed_customer_pain_point",
  "too_long",
  "too_short",
  "other",
] as const;

export type AiInsightFeedbackReasonTag = (typeof AI_INSIGHT_FEEDBACK_REASON_TAGS)[number];

export const AI_INSIGHT_FEEDBACK_TARGETS = [
  "legacy_overall",
  "base_deep",
  "phase2",
  "suggested_message",
] as const;

export type AiInsightFeedbackTarget = (typeof AI_INSIGHT_FEEDBACK_TARGETS)[number];

export const AI_INSIGHT_FEEDBACK_RATING_CODES = [
  "helpful",
  "not_helpful",
] as const;

export type AiInsightFeedbackRatingCode =
  (typeof AI_INSIGHT_FEEDBACK_RATING_CODES)[number];

/**
 * Phase 5D-1 expanded feedback table.
 * - Legacy rows: feedback_target=legacy_overall, rating 1–5, rating_code NULL
 * - Component rows: rating NULL, rating_code helpful|not_helpful
 */
export const aiInsightFeedback = sqliteTable(
  "ai_insight_feedback",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    aiInsightId: text("ai_insight_id")
      .notNull()
      .references(() => customerAiInsights.id, { onDelete: "cascade" }),
    insightGeneratedAt: text("insight_generated_at").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    sourceHash: text("source_hash").notNull(),
    /** Legacy 1–5 rating; NULL for new component feedback. */
    rating: integer("rating"),
    reasonTagsJson: text("reason_tags_json").notNull(),
    comment: text("comment"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by").references(() => users.id),
    generationKey: text("generation_key"),
    feedbackTarget: text("feedback_target", {
      enum: AI_INSIGHT_FEEDBACK_TARGETS,
    }).notNull(),
    ratingCode: text("rating_code", {
      enum: AI_INSIGHT_FEEDBACK_RATING_CODES,
    }),
    providerSnapshot: text("provider_snapshot"),
    contractModeSnapshot: text("contract_mode_snapshot"),
    phase2GeneratedSnapshot: integer("phase2_generated_snapshot", {
      mode: "boolean",
    }),
    actorRoleSnapshot: text("actor_role_snapshot"),
    degradationReasonSnapshot: text("degradation_reason_snapshot"),
  },
  (table) => [
    uniqueIndex("uq_ai_insight_feedback_legacy_customer_generated")
      .on(table.customerId, table.insightGeneratedAt)
      .where(sql`${table.feedbackTarget} = 'legacy_overall'`),
    uniqueIndex("uq_ai_insight_feedback_component_generation_actor_target")
      .on(table.generationKey, table.createdBy, table.feedbackTarget)
      .where(
        sql`${table.feedbackTarget} IN ('base_deep', 'phase2', 'suggested_message') AND ${table.generationKey} IS NOT NULL`,
      ),
    index("idx_ai_insight_feedback_customer_id").on(table.customerId),
    index("idx_ai_insight_feedback_ai_insight_id").on(table.aiInsightId),
    index("idx_ai_insight_feedback_created_at").on(table.createdAt),
    index("idx_ai_insight_feedback_model").on(table.model),
    index("idx_ai_insight_feedback_prompt_version").on(table.promptVersion),
    index("idx_ai_insight_feedback_target_rating_created").on(
      table.feedbackTarget,
      table.ratingCode,
      table.createdAt,
    ),
  ],
);

export type AiInsightFeedback = typeof aiInsightFeedback.$inferSelect;
export type NewAiInsightFeedback = typeof aiInsightFeedback.$inferInsert;
