import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { customers } from "./customers";

export const CUSTOMER_AI_INSIGHT_STATUSES = ["ready", "failed"] as const;
export type CustomerAiInsightStatus = (typeof CUSTOMER_AI_INSIGHT_STATUSES)[number];

export const CUSTOMER_AI_INTENT_LEVELS = ["high", "medium", "low", "unknown"] as const;
export type CustomerAiIntentLevel = (typeof CUSTOMER_AI_INTENT_LEVELS)[number];

export const customerAiInsights = sqliteTable(
  "customer_ai_insights",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .unique()
      .references(() => customers.id, { onDelete: "cascade" }),
    intentLevel: text("intent_level").notNull(),
    intentScore: integer("intent_score").notNull(),
    customerSummary: text("customer_summary").notNull(),
    currentSituation: text("current_situation").notNull(),
    keySignalsJson: text("key_signals_json").notNull(),
    riskFlagsJson: text("risk_flags_json").notNull(),
    missingInformationJson: text("missing_information_json").notNull(),
    nextBestAction: text("next_best_action").notNull(),
    suggestedFollowUpAt: text("suggested_follow_up_at"),
    suggestedEmployeeMessage: text("suggested_employee_message").notNull(),
    confidence: real("confidence").notNull(),
    reasoning: text("reasoning").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    sourceHash: text("source_hash").notNull(),
    status: text("status", { enum: CUSTOMER_AI_INSIGHT_STATUSES })
      .notNull()
      .default("ready"),
    generatedAt: text("generated_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_customer_ai_insights_customer_id").on(table.customerId),
    index("idx_customer_ai_insights_source_hash").on(table.sourceHash),
  ],
);

export type CustomerAiInsight = typeof customerAiInsights.$inferSelect;
export type NewCustomerAiInsight = typeof customerAiInsights.$inferInsert;
