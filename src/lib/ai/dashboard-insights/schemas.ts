import { z } from "zod";
import {
  DASHBOARD_AI_MAX_ACTIONS,
  DASHBOARD_AI_MAX_CAUTIONS,
  DASHBOARD_AI_MAX_CAUTION_LENGTH,
  DASHBOARD_AI_MAX_HEADLINE_LENGTH,
  DASHBOARD_AI_MAX_PRIORITIES,
  DASHBOARD_AI_MAX_REASON_LENGTH,
  DASHBOARD_AI_MAX_SUMMARY_LENGTH,
  DASHBOARD_AI_MAX_TITLE_LENGTH,
} from "./constants";

const noUnsafeMarkup = (value: string) =>
  !/<[^>]+>/.test(value) &&
  !/```/.test(value) &&
  !/javascript:/i.test(value);

const noExternalUrl = (value: string) =>
  !/https?:\/\//i.test(value) && !/www\./i.test(value);

const safeText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(noUnsafeMarkup, "unsafe_markup")
    .refine(noExternalUrl, "external_url");

const urgencySchema = z.enum(["normal", "attention", "urgent"]);

const adminCategorySchema = z.enum([
  "approvals",
  "follow_up",
  "reclamation",
  "public_pool",
  "pipeline",
]);

const staffCategorySchema = z.enum([
  "follow_up",
  "overdue",
  "reclamation",
  "work_item",
]);

const customerRefSchema = z
  .string()
  .regex(/^C\d+$/)
  .max(8);

export const adminBriefInsightSchema = z
  .object({
    headline: safeText(DASHBOARD_AI_MAX_HEADLINE_LENGTH),
    summary: safeText(DASHBOARD_AI_MAX_SUMMARY_LENGTH),
    priorities: z
      .array(
        z
          .object({
            category: adminCategorySchema,
            title: safeText(DASHBOARD_AI_MAX_TITLE_LENGTH),
            reason: safeText(DASHBOARD_AI_MAX_REASON_LENGTH),
            urgency: urgencySchema,
          })
          .strict(),
      )
      .max(DASHBOARD_AI_MAX_PRIORITIES),
    cautions: z
      .array(safeText(DASHBOARD_AI_MAX_CAUTION_LENGTH))
      .max(DASHBOARD_AI_MAX_CAUTIONS),
  })
  .strict();

export const staffTodayActionsInsightSchema = z
  .object({
    headline: safeText(DASHBOARD_AI_MAX_HEADLINE_LENGTH),
    actions: z
      .array(
        z
          .object({
            customerRef: customerRefSchema.optional(),
            category: staffCategorySchema,
            title: safeText(DASHBOARD_AI_MAX_TITLE_LENGTH),
            reason: safeText(DASHBOARD_AI_MAX_REASON_LENGTH),
            urgency: urgencySchema,
          })
          .strict(),
      )
      .max(DASHBOARD_AI_MAX_ACTIONS),
  })
  .strict();

export type ParsedAdminBriefInsight = z.infer<typeof adminBriefInsightSchema>;
export type ParsedStaffTodayActionsInsight = z.infer<
  typeof staffTodayActionsInsightSchema
>;

export function safeParseAdminBriefInsight(data: unknown) {
  return adminBriefInsightSchema.safeParse(data);
}

export function safeParseStaffTodayActionsInsight(data: unknown) {
  return staffTodayActionsInsightSchema.safeParse(data);
}

export const ADMIN_BRIEF_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "summary", "priorities", "cautions"],
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    priorities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "title", "reason", "urgency"],
        properties: {
          category: {
            type: "string",
            enum: [
              "approvals",
              "follow_up",
              "reclamation",
              "public_pool",
              "pipeline",
            ],
          },
          title: { type: "string" },
          reason: { type: "string" },
          urgency: { type: "string", enum: ["normal", "attention", "urgent"] },
        },
      },
    },
    cautions: { type: "array", items: { type: "string" } },
  },
} as const;

export const STAFF_TODAY_ACTIONS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "actions"],
  properties: {
    headline: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "title", "reason", "urgency"],
        properties: {
          customerRef: { type: "string" },
          category: {
            type: "string",
            enum: ["follow_up", "overdue", "reclamation", "work_item"],
          },
          title: { type: "string" },
          reason: { type: "string" },
          urgency: { type: "string", enum: ["normal", "attention", "urgent"] },
        },
      },
    },
  },
} as const;
