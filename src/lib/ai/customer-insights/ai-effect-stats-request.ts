/**
 * Query-string validation for GET /api/admin/ai-effect-stats
 */

import {
  AI_EFFECT_STATS_ALLOWED_RANGES,
  AI_EFFECT_STATS_DEFAULT_RANGE_DAYS,
  getAiEffectStatsDateRange,
  type AiEffectStatsDateRange,
  type AiEffectStatsRangeDays,
} from "@/lib/ai/customer-insights/ai-effect-stats-range";
import {
  normalizeActorRole,
  normalizeContractMode,
  normalizeProviderKind,
  sanitizeDimensionString,
  type AiEffectActorRole,
  type AiEffectContractMode,
  type AiEffectProviderKind,
} from "@/lib/ai/customer-insights/ai-effect-stats-normalize";

export class AiEffectStatsRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AiEffectStatsRequestError";
    this.status = status;
    this.code = code;
  }
}

export type AiEffectStatsFeedbackTargetFilter =
  | "all"
  | "base_deep"
  | "phase2"
  | "suggested_message"
  | "legacy_overall";

export type AiEffectStatsPhase2GeneratedFilter = "all" | "true" | "false" | "unknown";

export type AiEffectStatsFilters = {
  provider: AiEffectProviderKind | "all";
  model: string | null;
  promptVersion: string | null;
  contractMode: AiEffectContractMode | "all";
  actorRole: AiEffectActorRole | "all";
  feedbackTarget: AiEffectStatsFeedbackTargetFilter;
  phase2Generated: AiEffectStatsPhase2GeneratedFilter;
};

export type ParsedAiEffectStatsRequest = {
  range: AiEffectStatsDateRange;
  filters: AiEffectStatsFilters;
  filterScope: {
    common: Array<keyof AiEffectStatsFilters | "range">;
    feedbackOnly: Array<"feedbackTarget">;
  };
};

const FEEDBACK_TARGETS = new Set<string>([
  "all",
  "base_deep",
  "phase2",
  "suggested_message",
  "legacy_overall",
]);

const PHASE2_GENERATED = new Set<string>(["all", "true", "false", "unknown"]);

function parseRangeDays(raw: string | null): AiEffectStatsRangeDays {
  if (raw == null || raw === "") {
    return AI_EFFECT_STATS_DEFAULT_RANGE_DAYS;
  }
  if (!/^\d+$/.test(raw)) {
    throw new AiEffectStatsRequestError(400, "INVALID_RANGE", "Invalid range");
  }
  const days = Number(raw);
  if (
    !(AI_EFFECT_STATS_ALLOWED_RANGES as readonly number[]).includes(days)
  ) {
    throw new AiEffectStatsRequestError(400, "INVALID_RANGE", "Invalid range");
  }
  return days as AiEffectStatsRangeDays;
}

function parseProvider(raw: string | null): AiEffectProviderKind | "all" {
  if (raw == null) return "all";
  if (raw === "") {
    throw new AiEffectStatsRequestError(
      400,
      "INVALID_PROVIDER",
      "Invalid provider",
    );
  }
  if (raw === "all") return "all";
  const normalized = normalizeProviderKind(raw);
  if (normalized === "unknown" && raw !== "unknown") {
    throw new AiEffectStatsRequestError(
      400,
      "INVALID_PROVIDER",
      "Invalid provider",
    );
  }
  return normalized;
}

function parseContractMode(raw: string | null): AiEffectContractMode | "all" {
  if (raw == null) return "all";
  if (raw === "") {
    throw new AiEffectStatsRequestError(
      400,
      "INVALID_CONTRACT_MODE",
      "Invalid contractMode",
    );
  }
  if (raw === "all") return "all";
  if (
    raw !== "gemini_flat" &&
    raw !== "rich" &&
    raw !== "none" &&
    raw !== "unknown"
  ) {
    throw new AiEffectStatsRequestError(
      400,
      "INVALID_CONTRACT_MODE",
      "Invalid contractMode",
    );
  }
  return normalizeContractMode(raw);
}

function parseActorRole(raw: string | null): AiEffectActorRole | "all" {
  if (raw == null) return "all";
  if (raw === "") {
    throw new AiEffectStatsRequestError(
      400,
      "INVALID_ACTOR_ROLE",
      "Invalid actorRole",
    );
  }
  if (raw === "all") return "all";
  if (raw !== "admin" && raw !== "staff" && raw !== "unknown") {
    throw new AiEffectStatsRequestError(
      400,
      "INVALID_ACTOR_ROLE",
      "Invalid actorRole",
    );
  }
  return normalizeActorRole(raw);
}

function parseFeedbackTarget(
  raw: string | null,
): AiEffectStatsFeedbackTargetFilter {
  if (raw == null) return "all";
  if (raw === "") {
    throw new AiEffectStatsRequestError(
      400,
      "INVALID_FEEDBACK_TARGET",
      "Invalid feedbackTarget",
    );
  }
  if (!FEEDBACK_TARGETS.has(raw)) {
    throw new AiEffectStatsRequestError(
      400,
      "INVALID_FEEDBACK_TARGET",
      "Invalid feedbackTarget",
    );
  }
  return raw as AiEffectStatsFeedbackTargetFilter;
}

function parsePhase2Generated(
  raw: string | null,
): AiEffectStatsPhase2GeneratedFilter {
  if (raw == null) return "all";
  if (raw === "") {
    throw new AiEffectStatsRequestError(
      400,
      "INVALID_PHASE2_GENERATED",
      "Invalid phase2Generated",
    );
  }
  if (!PHASE2_GENERATED.has(raw)) {
    throw new AiEffectStatsRequestError(
      400,
      "INVALID_PHASE2_GENERATED",
      "Invalid phase2Generated",
    );
  }
  return raw as AiEffectStatsPhase2GeneratedFilter;
}

function parseExactDimension(
  raw: string | null,
  code: string,
): string | null {
  if (raw == null) return null;
  if (raw === "") {
    throw new AiEffectStatsRequestError(400, code, "Invalid filter value");
  }
  const sanitized = sanitizeDimensionString(raw, 100);
  if (sanitized == null || sanitized.includes("%") || sanitized.includes("*")) {
    throw new AiEffectStatsRequestError(400, code, "Invalid filter value");
  }
  return sanitized;
}

export function parseAiEffectStatsRequest(
  url: URL,
  now: Date = new Date(),
): ParsedAiEffectStatsRequest {
  const days = parseRangeDays(url.searchParams.get("range"));
  const filters: AiEffectStatsFilters = {
    provider: parseProvider(url.searchParams.get("provider")),
    model: parseExactDimension(url.searchParams.get("model"), "INVALID_MODEL"),
    promptVersion: parseExactDimension(
      url.searchParams.get("promptVersion"),
      "INVALID_PROMPT_VERSION",
    ),
    contractMode: parseContractMode(url.searchParams.get("contractMode")),
    actorRole: parseActorRole(url.searchParams.get("actorRole")),
    feedbackTarget: parseFeedbackTarget(url.searchParams.get("feedbackTarget")),
    phase2Generated: parsePhase2Generated(
      url.searchParams.get("phase2Generated"),
    ),
  };

  return {
    range: getAiEffectStatsDateRange(days, now),
    filters,
    filterScope: {
      common: [
        "range",
        "provider",
        "model",
        "promptVersion",
        "contractMode",
        "actorRole",
        "phase2Generated",
      ],
      feedbackOnly: ["feedbackTarget"],
    },
  };
}
