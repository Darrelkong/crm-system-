/**
 * Client filter state and query builder for GET /api/admin/ai-effect-stats.
 */

export type AiEffectStatsRangeDays = 7 | 30 | 90;

export type AiEffectStatsClientFilters = {
  range: AiEffectStatsRangeDays;
  provider: string;
  model: string;
  promptVersion: string;
  contractMode: string;
  actorRole: string;
  feedbackTarget: string;
  phase2Generated: string;
};

export const AI_EFFECT_STATS_DEFAULT_FILTERS: AiEffectStatsClientFilters = {
  range: 30,
  provider: "all",
  model: "all",
  promptVersion: "all",
  contractMode: "all",
  actorRole: "all",
  feedbackTarget: "all",
  phase2Generated: "all",
};

export const AI_EFFECT_STATS_RANGE_OPTIONS: AiEffectStatsRangeDays[] = [
  7, 30, 90,
];

export const AI_EFFECT_STATS_PROVIDER_OPTIONS = [
  "all",
  "google_gemini",
  "openai_compatible",
  "mock",
  "unknown",
] as const;

export const AI_EFFECT_STATS_CONTRACT_OPTIONS = [
  "all",
  "gemini_flat",
  "rich",
  "none",
  "unknown",
] as const;

export const AI_EFFECT_STATS_ACTOR_ROLE_OPTIONS = [
  "all",
  "admin",
  "staff",
  "unknown",
] as const;

export const AI_EFFECT_STATS_FEEDBACK_TARGET_OPTIONS = [
  "all",
  "base_deep",
  "phase2",
  "suggested_message",
  "legacy_overall",
] as const;

export const AI_EFFECT_STATS_PHASE2_GENERATED_OPTIONS = [
  "all",
  "true",
  "false",
  "unknown",
] as const;

export function buildAiEffectStatsSearchParams(
  filters: AiEffectStatsClientFilters,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("range", String(filters.range));

  if (filters.provider !== "all") {
    params.set("provider", filters.provider);
  }
  if (filters.model !== "all") {
    params.set("model", filters.model);
  }
  if (filters.promptVersion !== "all") {
    params.set("promptVersion", filters.promptVersion);
  }
  if (filters.contractMode !== "all") {
    params.set("contractMode", filters.contractMode);
  }
  if (filters.actorRole !== "all") {
    params.set("actorRole", filters.actorRole);
  }
  if (filters.feedbackTarget !== "all") {
    params.set("feedbackTarget", filters.feedbackTarget);
  }
  if (filters.phase2Generated !== "all") {
    params.set("phase2Generated", filters.phase2Generated);
  }

  return params;
}

export function buildAiEffectStatsUrl(
  filters: AiEffectStatsClientFilters,
): string {
  const params = buildAiEffectStatsSearchParams(filters);
  const query = params.toString();
  return query
    ? `/api/admin/ai-effect-stats?${query}`
    : "/api/admin/ai-effect-stats";
}

/** Keep a selected dimension value visible even if it dropped out of the latest dimensions list. */
export function mergeDimensionOptions(
  selected: string,
  fromApi: readonly string[],
): string[] {
  const values = new Set<string>(["all"]);
  for (const value of fromApi) {
    if (typeof value === "string" && value.length > 0) {
      values.add(value);
    }
  }
  if (selected !== "all" && selected.length > 0) {
    values.add(selected);
  }
  return Array.from(values);
}

export function truncateDimensionLabel(
  value: string,
  max = 48,
): { display: string; title: string } {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (cleaned.length <= max) {
    return { display: cleaned, title: cleaned };
  }
  return {
    display: `${cleaned.slice(0, max - 1)}…`,
    title: cleaned,
  };
}
