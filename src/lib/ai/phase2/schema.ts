import { z } from "zod";
import {
  CONFIDENCE_LEVELS,
  OPPORTUNITY_CATEGORY_CODES,
  PAIN_POINT_CODES,
  EVIDENCE_SOURCE_TYPES,
  PHASE2_LIMITS,
  PHASE2_VERSION,
} from "@/lib/ai/phase2/types";

const confidenceSchema = z.enum(CONFIDENCE_LEVELS);

const noHtml = (value: string) =>
  !/<[^>]+>/.test(value) && !/<script/i.test(value);

const noFence = (value: string) => !/```/.test(value);

const safeText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(noHtml, "HTML is not allowed")
    .refine(noFence, "Markdown fences are not allowed");

const optionalSafeText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => v.length === 0 || noHtml(v), "HTML is not allowed")
    .refine((v) => v.length === 0 || noFence(v), "Markdown fences are not allowed")
    .nullable();

export const evidenceReferenceSchema = z
  .object({
    sourceType: z.enum(EVIDENCE_SOURCE_TYPES),
    sourceId: z.string().trim().min(1).nullable(),
    occurredAt: z.string().trim().min(1).nullable(),
    excerpt: safeText(PHASE2_LIMITS.evidenceExcerptMaxChars),
    field: z.string().trim().min(1).max(80).nullable(),
  })
  .strict();

export const evidenceBackedFactorSchema = z
  .object({
    code: z.string().trim().min(1).max(64),
    summary: safeText(PHASE2_LIMITS.summaryMaxChars),
    confidence: confidenceSchema,
    evidence: z
      .array(evidenceReferenceSchema)
      .max(PHASE2_LIMITS.evidencePerFactorMax),
  })
  .strict();

export const opportunityScoreBreakdownSchema = z
  .object({
    code: z.enum(OPPORTUNITY_CATEGORY_CODES),
    labelKey: z.string().trim().min(1).max(120),
    weight: z.number().int().min(0).max(100),
    status: z.enum(["scored", "insufficient_data", "not_applicable"]),
    score: z.number().int().min(0).max(100).nullable(),
    weightedScore: z.number().min(0).max(100).nullable(),
    confidence: confidenceSchema,
    basis: z
      .array(evidenceReferenceSchema)
      .max(PHASE2_LIMITS.evidencePerFactorMax),
    explanation: safeText(PHASE2_LIMITS.summaryMaxChars),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "scored") {
      if (value.score === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "scored category requires score",
          path: ["score"],
        });
      }
    } else if (value.score !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "non-scored category must have null score",
        path: ["score"],
      });
    }
  });

export const opportunityAssessmentSchema = z
  .object({
    status: z.enum(["available", "insufficient_data"]),
    score: z.number().int().min(0).max(100).nullable(),
    confidence: confidenceSchema,
    trend: z.enum(["up", "stable", "down", "unavailable"]),
    breakdown: z.array(opportunityScoreBreakdownSchema).max(20),
    positiveFactors: z.array(evidenceBackedFactorSchema).max(10),
    negativeFactors: z.array(evidenceBackedFactorSchema).max(10),
    recommendedAction: optionalSafeText(PHASE2_LIMITS.recommendedActionMaxChars),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "insufficient_data" && value.score !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "insufficient_data must use score=null",
        path: ["score"],
      });
    }
    if (value.status === "available" && value.score === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "available status requires score",
        path: ["score"],
      });
    }
    if (value.trend !== "unavailable") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "phase-2-v1 trend must be unavailable",
        path: ["trend"],
      });
    }
  });

export const painPointAssessmentSchema = z
  .object({
    code: z.enum(PAIN_POINT_CODES),
    labelKey: z.string().trim().min(1).max(120),
    severity: z.enum(["low", "medium", "high"]),
    confidence: confidenceSchema,
    summary: safeText(PHASE2_LIMITS.summaryMaxChars),
    evidence: z
      .array(evidenceReferenceSchema)
      .min(1)
      .max(PHASE2_LIMITS.evidencePerPainPointMax),
    recommendedResponse: optionalSafeText(
      PHASE2_LIMITS.recommendedActionMaxChars,
    ),
  })
  .strict();

export const riskSignalSchema = z
  .object({
    code: z.string().trim().min(1).max(64),
    summary: safeText(PHASE2_LIMITS.summaryMaxChars),
    confidence: confidenceSchema,
    evidence: z
      .array(evidenceReferenceSchema)
      .max(PHASE2_LIMITS.evidencePerFactorMax),
  })
  .strict();

export const churnRiskAssessmentSchema = z
  .object({
    level: z.enum(["low", "medium", "high", "insufficient_data"]),
    confidence: confidenceSchema,
    customerBehaviorRisk: z
      .array(riskSignalSchema)
      .max(PHASE2_LIMITS.riskSignalsMax),
    crmProcessRisk: z.array(riskSignalSchema).max(PHASE2_LIMITS.riskSignalsMax),
    evidence: z
      .array(evidenceReferenceSchema)
      .max(PHASE2_LIMITS.evidenceTotalMax),
    summary: safeText(PHASE2_LIMITS.summaryMaxChars),
  })
  .strict();

const yyyyMmDd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number);
    const dt = new Date(Date.UTC(y!, m! - 1, d!));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m! - 1 &&
      dt.getUTCDate() === d
    );
  }, "date must be a real calendar day")
  .nullable();

export const followUpRecommendationSchema = z
  .object({
    date: yyyyMmDd,
    timeWindow: z.null(),
    channel: z.string().trim().min(1).max(40).nullable(),
    topic: optionalSafeText(PHASE2_LIMITS.topicMaxChars),
    confidence: confidenceSchema,
    basis: z
      .array(evidenceReferenceSchema)
      .max(PHASE2_LIMITS.evidencePerFactorMax),
    insufficientDataReason: optionalSafeText(PHASE2_LIMITS.summaryMaxChars),
  })
  .strict();

export const missingInformationItemSchema = z
  .object({
    code: z.string().trim().min(1).max(64),
    summary: safeText(PHASE2_LIMITS.summaryMaxChars),
  })
  .strict();

export const phase2InsightSchema = z
  .object({
    version: z.literal(PHASE2_VERSION),
    opportunity: opportunityAssessmentSchema,
    painPoints: z
      .array(painPointAssessmentSchema)
      .max(PHASE2_LIMITS.painPointsMax),
    churnRisk: churnRiskAssessmentSchema,
    followUpRecommendation: followUpRecommendationSchema,
    missingInformation: z.array(missingInformationItemSchema).max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    let evidenceCount = 0;
    for (const item of value.opportunity.breakdown) {
      evidenceCount += item.basis.length;
    }
    for (const item of value.opportunity.positiveFactors) {
      evidenceCount += item.evidence.length;
    }
    for (const item of value.opportunity.negativeFactors) {
      evidenceCount += item.evidence.length;
    }
    for (const item of value.painPoints) {
      evidenceCount += item.evidence.length;
    }
    evidenceCount += value.churnRisk.evidence.length;
    evidenceCount += value.followUpRecommendation.basis.length;
    if (evidenceCount > PHASE2_LIMITS.evidenceTotalMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `total evidence exceeds ${PHASE2_LIMITS.evidenceTotalMax}`,
      });
    }
  });

export const evidenceBackedSignalSchema = z
  .object({
    level: z.enum(["low", "medium", "high"]),
    confidence: confidenceSchema,
    summary: safeText(PHASE2_LIMITS.summaryMaxChars),
    evidence: z
      .array(evidenceReferenceSchema)
      .min(1)
      .max(PHASE2_LIMITS.evidencePerFactorMax),
  })
  .strict();

export const phase2ExtractedSignalsSchema = z
  .object({
    needClarity: evidenceBackedSignalSchema.nullable(),
    customerInitiative: evidenceBackedSignalSchema.nullable(),
    timelineReadiness: evidenceBackedSignalSchema.nullable(),
    documentReadiness: evidenceBackedSignalSchema.nullable(),
    concerns: z
      .array(
        evidenceBackedSignalSchema
          .extend({
            code: z.enum(PAIN_POINT_CODES),
          })
          .strict(),
      )
      .max(PHASE2_LIMITS.painPointsMax),
    customerBehaviorRisk: z
      .array(
        evidenceBackedSignalSchema
          .extend({
            code: z.string().trim().min(1).max(64),
            kind: z.enum(["customer_behavior", "crm_process"]),
          })
          .strict(),
      )
      .max(PHASE2_LIMITS.riskSignalsMax),
    recommendedTopic: evidenceBackedSignalSchema.nullable(),
  })
  .strict();

export function safeParsePhase2Insight(data: unknown) {
  return phase2InsightSchema.safeParse(data);
}

export function safeParsePhase2ExtractedSignals(data: unknown) {
  return phase2ExtractedSignalsSchema.safeParse(data);
}
