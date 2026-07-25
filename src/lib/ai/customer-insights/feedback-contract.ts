/**
 * Phase 5D-1 Feedback contracts: targets, binary ratings, target-specific tags,
 * and snapshot dimensions. No API wiring in this phase.
 */

import {
  AI_INSIGHT_FEEDBACK_REASON_TAGS,
  type AiInsightFeedbackReasonTag,
} from "../../../../drizzle/schema/ai-insight-feedback";

export const AI_INSIGHT_FEEDBACK_TARGETS = [
  "legacy_overall",
  "base_deep",
  "phase2",
  "suggested_message",
] as const;

export type AiInsightFeedbackTarget = (typeof AI_INSIGHT_FEEDBACK_TARGETS)[number];

/** Targets allowed for new component feedback submissions (future API). */
export const AI_INSIGHT_FEEDBACK_COMPONENT_TARGETS = [
  "base_deep",
  "phase2",
  "suggested_message",
] as const;

export type AiInsightFeedbackComponentTarget =
  (typeof AI_INSIGHT_FEEDBACK_COMPONENT_TARGETS)[number];

export const AI_INSIGHT_FEEDBACK_RATING_CODES = [
  "helpful",
  "not_helpful",
] as const;

export type AiInsightFeedbackRatingCode =
  (typeof AI_INSIGHT_FEEDBACK_RATING_CODES)[number];

export const AI_INSIGHT_FEEDBACK_MAX_COMPONENT_TAGS = 4;

export const AI_INSIGHT_FEEDBACK_PROVIDER_SNAPSHOTS = [
  "google_gemini",
  "openai_compatible",
  "mock",
  "unknown",
] as const;

export type AiInsightFeedbackProviderSnapshot =
  (typeof AI_INSIGHT_FEEDBACK_PROVIDER_SNAPSHOTS)[number];

export const AI_INSIGHT_FEEDBACK_CONTRACT_MODE_SNAPSHOTS = [
  "gemini_flat",
  "rich",
  "none",
  "unknown",
] as const;

export type AiInsightFeedbackContractModeSnapshot =
  (typeof AI_INSIGHT_FEEDBACK_CONTRACT_MODE_SNAPSHOTS)[number];

export const AI_INSIGHT_FEEDBACK_ACTOR_ROLE_SNAPSHOTS = [
  "admin",
  "staff",
] as const;

export type AiInsightFeedbackActorRoleSnapshot =
  (typeof AI_INSIGHT_FEEDBACK_ACTOR_ROLE_SNAPSHOTS)[number];

export const AI_INSIGHT_FEEDBACK_BASE_DEEP_POSITIVE_TAGS = [
  "accurate_summary",
  "clear_next_step",
  "useful_risk_identification",
  "saves_time",
] as const;

export const AI_INSIGHT_FEEDBACK_BASE_DEEP_NEGATIVE_TAGS = [
  "inaccurate",
  "too_generic",
  "missed_key_information",
  "unsupported_inference",
  "next_step_not_useful",
  "outdated_context",
] as const;

export const AI_INSIGHT_FEEDBACK_PHASE2_POSITIVE_TAGS = [
  "score_reasonable",
  "pain_points_useful",
  "risk_analysis_useful",
  "recommendation_actionable",
  "evidence_helpful",
] as const;

export const AI_INSIGHT_FEEDBACK_PHASE2_NEGATIVE_TAGS = [
  "score_unreasonable",
  "missing_evidence",
  "evidence_not_relevant",
  "pain_point_inaccurate",
  "risk_inaccurate",
  "recommendation_not_actionable",
  "insufficient_data",
] as const;

export const AI_INSIGHT_FEEDBACK_SUGGESTED_MESSAGE_POSITIVE_TAGS = [
  "ready_to_send",
  "natural_tone",
  "useful_starting_point",
  "matches_customer_context",
] as const;

export const AI_INSIGHT_FEEDBACK_SUGGESTED_MESSAGE_NEGATIVE_TAGS = [
  "sounds_robotic",
  "too_long",
  "too_pushy",
  "inaccurate_details",
  "unsuitable_tone",
  "requires_major_edit",
] as const;

export type AiInsightFeedbackBaseDeepTag =
  | (typeof AI_INSIGHT_FEEDBACK_BASE_DEEP_POSITIVE_TAGS)[number]
  | (typeof AI_INSIGHT_FEEDBACK_BASE_DEEP_NEGATIVE_TAGS)[number];

export type AiInsightFeedbackPhase2Tag =
  | (typeof AI_INSIGHT_FEEDBACK_PHASE2_POSITIVE_TAGS)[number]
  | (typeof AI_INSIGHT_FEEDBACK_PHASE2_NEGATIVE_TAGS)[number];

export type AiInsightFeedbackSuggestedMessageTag =
  | (typeof AI_INSIGHT_FEEDBACK_SUGGESTED_MESSAGE_POSITIVE_TAGS)[number]
  | (typeof AI_INSIGHT_FEEDBACK_SUGGESTED_MESSAGE_NEGATIVE_TAGS)[number];

export type AiInsightFeedbackComponentTag =
  | AiInsightFeedbackBaseDeepTag
  | AiInsightFeedbackPhase2Tag
  | AiInsightFeedbackSuggestedMessageTag;

const BASE_DEEP_TAG_SET = new Set<string>([
  ...AI_INSIGHT_FEEDBACK_BASE_DEEP_POSITIVE_TAGS,
  ...AI_INSIGHT_FEEDBACK_BASE_DEEP_NEGATIVE_TAGS,
]);

const PHASE2_TAG_SET = new Set<string>([
  ...AI_INSIGHT_FEEDBACK_PHASE2_POSITIVE_TAGS,
  ...AI_INSIGHT_FEEDBACK_PHASE2_NEGATIVE_TAGS,
]);

const SUGGESTED_MESSAGE_TAG_SET = new Set<string>([
  ...AI_INSIGHT_FEEDBACK_SUGGESTED_MESSAGE_POSITIVE_TAGS,
  ...AI_INSIGHT_FEEDBACK_SUGGESTED_MESSAGE_NEGATIVE_TAGS,
]);

const COMPONENT_TAG_ORDER: readonly string[] = [
  ...AI_INSIGHT_FEEDBACK_BASE_DEEP_POSITIVE_TAGS,
  ...AI_INSIGHT_FEEDBACK_BASE_DEEP_NEGATIVE_TAGS,
  ...AI_INSIGHT_FEEDBACK_PHASE2_POSITIVE_TAGS,
  ...AI_INSIGHT_FEEDBACK_PHASE2_NEGATIVE_TAGS,
  ...AI_INSIGHT_FEEDBACK_SUGGESTED_MESSAGE_POSITIVE_TAGS,
  ...AI_INSIGHT_FEEDBACK_SUGGESTED_MESSAGE_NEGATIVE_TAGS,
];

export type AiInsightFeedbackSnapshotInput = {
  providerSnapshot: AiInsightFeedbackProviderSnapshot;
  modelSnapshot: string;
  promptVersionSnapshot: string;
  contractModeSnapshot: AiInsightFeedbackContractModeSnapshot;
  phase2GeneratedSnapshot: boolean;
  actorRoleSnapshot: AiInsightFeedbackActorRoleSnapshot;
  degradationReasonSnapshot?: string | null;
};

export function isAiInsightFeedbackTarget(
  value: unknown,
): value is AiInsightFeedbackTarget {
  return (
    typeof value === "string" &&
    (AI_INSIGHT_FEEDBACK_TARGETS as readonly string[]).includes(value)
  );
}

export function isAiInsightFeedbackComponentTarget(
  value: unknown,
): value is AiInsightFeedbackComponentTarget {
  return (
    typeof value === "string" &&
    (AI_INSIGHT_FEEDBACK_COMPONENT_TARGETS as readonly string[]).includes(value)
  );
}

/**
 * Exact lowercase match only. Does not auto-lowercase or accept whitespace variants.
 */
export function validateFeedbackTarget(
  value: unknown,
): AiInsightFeedbackTarget | null {
  if (typeof value !== "string") {
    return null;
  }
  if (value !== value.trim()) {
    return null;
  }
  return isAiInsightFeedbackTarget(value) ? value : null;
}

/** New submissions may not create legacy_overall rows. */
export function validateComponentFeedbackTarget(
  value: unknown,
): AiInsightFeedbackComponentTarget | null {
  if (typeof value !== "string") {
    return null;
  }
  if (value !== value.trim()) {
    return null;
  }
  return isAiInsightFeedbackComponentTarget(value) ? value : null;
}

export function validateFeedbackRating(
  value: unknown,
): AiInsightFeedbackRatingCode | null {
  if (typeof value !== "string") {
    return null;
  }
  if (value !== value.trim()) {
    return null;
  }
  return (AI_INSIGHT_FEEDBACK_RATING_CODES as readonly string[]).includes(value)
    ? (value as AiInsightFeedbackRatingCode)
    : null;
}

function tagSetForTarget(target: AiInsightFeedbackComponentTarget): Set<string> {
  if (target === "base_deep") {
    return BASE_DEEP_TAG_SET;
  }
  if (target === "phase2") {
    return PHASE2_TAG_SET;
  }
  return SUGGESTED_MESSAGE_TAG_SET;
}

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Validates and normalizes component tags for a target.
 * Returns null on any invalid input. Empty array is valid.
 */
export function validateFeedbackTags(
  target: AiInsightFeedbackComponentTarget,
  tags: unknown,
): AiInsightFeedbackComponentTag[] | null {
  if (!Array.isArray(tags)) {
    return null;
  }
  if (tags.length > AI_INSIGHT_FEEDBACK_MAX_COMPONENT_TAGS) {
    return null;
  }

  const allowed = tagSetForTarget(target);
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const tag of tags) {
    if (typeof tag !== "string") {
      return null;
    }
    if (tag !== tag.trim() || tag.length === 0) {
      return null;
    }
    if (hasControlCharacters(tag)) {
      return null;
    }
    if (!allowed.has(tag)) {
      return null;
    }
    if (seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    normalized.push(tag);
  }

  return sortFeedbackTags(normalized) as AiInsightFeedbackComponentTag[];
}

export function normalizeFeedbackTags(
  target: AiInsightFeedbackComponentTarget,
  tags: unknown,
): AiInsightFeedbackComponentTag[] | null {
  return validateFeedbackTags(target, tags);
}

export function sortFeedbackTags(tags: readonly string[]): string[] {
  return [...tags].sort((a, b) => {
    const ai = COMPONENT_TAG_ORDER.indexOf(a);
    const bi = COMPONENT_TAG_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) {
      return a.localeCompare(b);
    }
    if (ai === -1) {
      return 1;
    }
    if (bi === -1) {
      return -1;
    }
    return ai - bi;
  });
}

export function serializeFeedbackTags(tags: readonly string[]): string {
  return JSON.stringify(sortFeedbackTags(tags));
}

export function parseFeedbackTags(tagsJson: string): string[] {
  try {
    const parsed = JSON.parse(tagsJson) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((tag): tag is string => typeof tag === "string");
  } catch {
    return [];
  }
}

export function isLegacyFeedbackReasonTag(
  tag: string,
): tag is AiInsightFeedbackReasonTag {
  return (AI_INSIGHT_FEEDBACK_REASON_TAGS as readonly string[]).includes(tag);
}

export function createFeedbackSnapshotInput(
  input: AiInsightFeedbackSnapshotInput,
): AiInsightFeedbackSnapshotInput | null {
  if (
    !(AI_INSIGHT_FEEDBACK_PROVIDER_SNAPSHOTS as readonly string[]).includes(
      input.providerSnapshot,
    )
  ) {
    return null;
  }
  if (
    !(AI_INSIGHT_FEEDBACK_CONTRACT_MODE_SNAPSHOTS as readonly string[]).includes(
      input.contractModeSnapshot,
    )
  ) {
    return null;
  }
  if (
    !(AI_INSIGHT_FEEDBACK_ACTOR_ROLE_SNAPSHOTS as readonly string[]).includes(
      input.actorRoleSnapshot,
    )
  ) {
    return null;
  }
  if (typeof input.phase2GeneratedSnapshot !== "boolean") {
    return null;
  }
  if (typeof input.modelSnapshot !== "string" || input.modelSnapshot.trim() === "") {
    return null;
  }
  if (
    typeof input.promptVersionSnapshot !== "string" ||
    input.promptVersionSnapshot.trim() === ""
  ) {
    return null;
  }
  if (
    input.degradationReasonSnapshot !== undefined &&
    input.degradationReasonSnapshot !== null &&
    typeof input.degradationReasonSnapshot !== "string"
  ) {
    return null;
  }

  return {
    providerSnapshot: input.providerSnapshot,
    modelSnapshot: input.modelSnapshot.trim(),
    promptVersionSnapshot: input.promptVersionSnapshot.trim(),
    contractModeSnapshot: input.contractModeSnapshot,
    phase2GeneratedSnapshot: input.phase2GeneratedSnapshot,
    actorRoleSnapshot: input.actorRoleSnapshot,
    degradationReasonSnapshot:
      input.degradationReasonSnapshot === undefined
        ? null
        : input.degradationReasonSnapshot === null
          ? null
          : input.degradationReasonSnapshot.trim() || null,
  };
}

export type LegacyFeedbackMappedRow = {
  feedbackTarget: "legacy_overall";
  ratingCode: null;
  rating: number;
  reasonTags: AiInsightFeedbackReasonTag[];
  comment: string | null;
  providerSnapshot: null;
  contractModeSnapshot: null;
  phase2GeneratedSnapshot: null;
  actorRoleSnapshot: null;
  degradationReasonSnapshot: null;
};

/**
 * Maps a preserved legacy row for stats/display. Does not invent component targets.
 */
export function mapLegacyFeedback(input: {
  rating: number;
  reasonTagsJson: string;
  comment: string | null;
}): LegacyFeedbackMappedRow | null {
  if (
    typeof input.rating !== "number" ||
    !Number.isInteger(input.rating) ||
    input.rating < 1 ||
    input.rating > 5
  ) {
    return null;
  }

  let reasonTags: AiInsightFeedbackReasonTag[] = [];
  try {
    const parsed = JSON.parse(input.reasonTagsJson) as unknown;
    if (Array.isArray(parsed)) {
      reasonTags = parsed.filter(
        (tag): tag is AiInsightFeedbackReasonTag =>
          typeof tag === "string" && isLegacyFeedbackReasonTag(tag),
      );
    }
  } catch {
    reasonTags = [];
  }

  return {
    feedbackTarget: "legacy_overall",
    ratingCode: null,
    rating: input.rating,
    reasonTags,
    comment: input.comment,
    providerSnapshot: null,
    contractModeSnapshot: null,
    phase2GeneratedSnapshot: null,
    actorRoleSnapshot: null,
    degradationReasonSnapshot: null,
  };
}
