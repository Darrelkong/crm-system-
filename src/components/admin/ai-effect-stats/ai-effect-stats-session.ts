/**
 * Pure session reducer for Admin AI Effect Stats load results.
 * Strategy A: on filter-update failure, revert filters to last successful values.
 */

import {
  AI_EFFECT_STATS_DEFAULT_FILTERS,
  type AiEffectStatsClientFilters,
} from "@/components/admin/ai-effect-stats/ai-effect-stats-filters";
import type {
  AiEffectStatsFetchErrorKind,
  AiEffectStatsFetchResult,
} from "@/components/admin/ai-effect-stats/fetch-ai-effect-stats";
import type { AiEffectStatsClientResponse } from "@/components/admin/ai-effect-stats/parse-ai-effect-stats-response";

export type AiEffectStatsLoadState =
  | { status: "idle" }
  | { status: "loading"; isInitial: boolean }
  | { status: "ready" }
  | { status: "error"; kind: AiEffectStatsFetchErrorKind };

export type AiEffectStatsSessionState = {
  filters: AiEffectStatsClientFilters;
  committedFilters: AiEffectStatsClientFilters;
  stats: AiEffectStatsClientResponse | null;
  loadState: AiEffectStatsLoadState;
};

export function createInitialAiEffectStatsSession(): AiEffectStatsSessionState {
  return {
    filters: { ...AI_EFFECT_STATS_DEFAULT_FILTERS },
    committedFilters: { ...AI_EFFECT_STATS_DEFAULT_FILTERS },
    stats: null,
    loadState: { status: "loading", isInitial: true },
  };
}

export function beginAiEffectStatsLoad(
  state: AiEffectStatsSessionState,
  nextFilters: AiEffectStatsClientFilters,
  isInitial: boolean,
): AiEffectStatsSessionState {
  return {
    ...state,
    filters: { ...nextFilters },
    loadState: { status: "loading", isInitial },
  };
}

/**
 * Apply a fetch result that belongs to the current sequence.
 * Aborted results must not be passed here (caller ignores them).
 */
export function applyAiEffectStatsLoadResult(
  state: AiEffectStatsSessionState,
  requestedFilters: AiEffectStatsClientFilters,
  result: AiEffectStatsFetchResult,
): AiEffectStatsSessionState {
  if (!result.ok) {
    if (result.kind === "auth") {
      return {
        ...state,
        filters: { ...state.committedFilters },
        stats: null,
        loadState: { status: "error", kind: result.kind },
      };
    }

    // Strategy A: keep last successful data and revert filters to committed.
    if (state.stats != null) {
      return {
        ...state,
        filters: { ...state.committedFilters },
        loadState: { status: "error", kind: result.kind },
      };
    }

    return {
      ...state,
      filters: { ...requestedFilters },
      stats: null,
      loadState: { status: "error", kind: result.kind },
    };
  }

  return {
    ...state,
    filters: { ...requestedFilters },
    committedFilters: { ...requestedFilters },
    stats: result.data,
    loadState: { status: "ready" },
  };
}
