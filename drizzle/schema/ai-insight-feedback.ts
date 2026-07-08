import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { customerAiInsights } from "./customer-ai-insights";
import { customers } from "./customers";
import { users } from "./users";

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
    rating: integer("rating").notNull(),
    reasonTagsJson: text("reason_tags_json").notNull(),
    comment: text("comment"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by").references(() => users.id),
  },
  (table) => [
    uniqueIndex("uq_ai_insight_feedback_customer_generated").on(
      table.customerId,
      table.insightGeneratedAt,
    ),
    index("idx_ai_insight_feedback_customer_id").on(table.customerId),
    index("idx_ai_insight_feedback_ai_insight_id").on(table.aiInsightId),
    index("idx_ai_insight_feedback_created_at").on(table.createdAt),
    index("idx_ai_insight_feedback_model").on(table.model),
    index("idx_ai_insight_feedback_prompt_version").on(table.promptVersion),
  ],
);

export type AiInsightFeedback = typeof aiInsightFeedback.$inferSelect;
export type NewAiInsightFeedback = typeof aiInsightFeedback.$inferInsert;
