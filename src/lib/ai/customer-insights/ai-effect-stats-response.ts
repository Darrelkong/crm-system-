/**
 * Response contract for GET /api/admin/ai-effect-stats
 */

import type { AiEffectRate } from "@/lib/ai/customer-insights/ai-effect-stats-rate";
import { buildAiEffectRate } from "@/lib/ai/customer-insights/ai-effect-stats-rate";
import type {
  AiEffectStatsDateRange,
} from "@/lib/ai/customer-insights/ai-effect-stats-range";
import type {
  AiEffectStatsFilters,
  ParsedAiEffectStatsRequest,
} from "@/lib/ai/customer-insights/ai-effect-stats-request";

export type AiEffectCodeCount = {
  code: string;
  count: number;
};

export type AiEffectTargetFeedbackStats = {
  submittedCount: number;
  helpfulCount: number;
  notHelpfulCount: number;
  helpfulRate: AiEffectRate;
  positiveTags: AiEffectCodeCount[];
  negativeTags: AiEffectCodeCount[];
};

export type AiEffectStatsResponse = {
  ok: true;
  range: {
    days: AiEffectStatsDateRange["days"];
    from: string;
    to: string;
    timezone: AiEffectStatsDateRange["timezone"];
  };
  filters: AiEffectStatsFilters;
  filterScope: ParsedAiEffectStatsRequest["filterScope"];
  overview: {
    completedAttempts: number;
    baseReady: number;
    failed: number;
    baseSuccessRate: AiEffectRate;
    refreshFailureRate: AiEffectRate;
    uniqueCustomers: number;
    uniqueActors: number;
    byActorRole: {
      admin: number;
      staff: number;
      unknown: number;
    };
  };
  failures: {
    provider: number;
    nonProvider: number;
    unknownStage: number;
  };
  phase2: {
    eligibleReady: number;
    generated: number;
    safeDegraded: number;
    unknownOutcome: number;
    ineligibleReady: number;
    unknownEligibility: number;
    generationRate: AiEffectRate;
    safeDegradationRate: AiEffectRate;
    degradationReasons: AiEffectCodeCount[];
  };
  feedback: {
    submitted: number;
    uniqueActors: number;
    uniqueGenerations: number;
    coverageAvailable: false;
    coverageValue: null;
    coverageUnavailableReason: "actor_target_exposure_not_recorded";
    byTarget: {
      baseDeep: AiEffectTargetFeedbackStats;
      phase2: AiEffectTargetFeedbackStats;
      suggestedMessage: AiEffectTargetFeedbackStats;
    };
  };
  legacyFeedback: {
    submittedCount: number;
    averageRating: number | null;
    helpfulCount: number;
    neutralCount: number;
    notHelpfulCount: number;
    tagCounts: AiEffectCodeCount[];
  };
  dimensions: {
    providers: string[];
    models: string[];
    promptVersions: string[];
    contractModes: string[];
  };
  dataQuality: {
    legacyRefreshEvents: number;
    unknownProviderEvents: number;
    unknownContractEvents: number;
    unknownActorRoleEvents: number;
    unknownPhase2OutcomeEvents: number;
    invalidTagRows: number;
    malformedAuditMetadataEvents: number;
  };
};

export const AI_EFFECT_STATS_FORBIDDEN_RESPONSE_KEYS = [
  "customerId",
  "customerName",
  "actorId",
  "actorName",
  "userId",
  "createdByName",
  "displayName",
  "email",
  "phone",
  "wechat",
  "address",
  "prompt",
  "context",
  "evidence",
  "suggestedEmployeeMessage",
  "comment",
  "sourceHash",
  "generationKey",
  "aiInsightId",
  "metadata",
  "raw",
] as const;

function emptyTargetStats(): AiEffectTargetFeedbackStats {
  return {
    submittedCount: 0,
    helpfulCount: 0,
    notHelpfulCount: 0,
    helpfulRate: buildAiEffectRate(0, 0),
    positiveTags: [],
    negativeTags: [],
  };
}

export function emptyAiEffectStatsResponse(
  parsed: ParsedAiEffectStatsRequest,
): AiEffectStatsResponse {
  return {
    ok: true,
    range: {
      days: parsed.range.days,
      from: parsed.range.from,
      to: parsed.range.to,
      timezone: parsed.range.timezone,
    },
    filters: parsed.filters,
    filterScope: parsed.filterScope,
    overview: {
      completedAttempts: 0,
      baseReady: 0,
      failed: 0,
      baseSuccessRate: buildAiEffectRate(0, 0),
      refreshFailureRate: buildAiEffectRate(0, 0),
      uniqueCustomers: 0,
      uniqueActors: 0,
      byActorRole: { admin: 0, staff: 0, unknown: 0 },
    },
    failures: {
      provider: 0,
      nonProvider: 0,
      unknownStage: 0,
    },
    phase2: {
      eligibleReady: 0,
      generated: 0,
      safeDegraded: 0,
      unknownOutcome: 0,
      ineligibleReady: 0,
      unknownEligibility: 0,
      generationRate: buildAiEffectRate(0, 0),
      safeDegradationRate: buildAiEffectRate(0, 0),
      degradationReasons: [],
    },
    feedback: {
      submitted: 0,
      uniqueActors: 0,
      uniqueGenerations: 0,
      coverageAvailable: false,
      coverageValue: null,
      coverageUnavailableReason: "actor_target_exposure_not_recorded",
      byTarget: {
        baseDeep: emptyTargetStats(),
        phase2: emptyTargetStats(),
        suggestedMessage: emptyTargetStats(),
      },
    },
    legacyFeedback: {
      submittedCount: 0,
      averageRating: null,
      helpfulCount: 0,
      neutralCount: 0,
      notHelpfulCount: 0,
      tagCounts: [],
    },
    dimensions: {
      providers: [],
      models: [],
      promptVersions: [],
      contractModes: [],
    },
    dataQuality: {
      legacyRefreshEvents: 0,
      unknownProviderEvents: 0,
      unknownContractEvents: 0,
      unknownActorRoleEvents: 0,
      unknownPhase2OutcomeEvents: 0,
      invalidTagRows: 0,
      malformedAuditMetadataEvents: 0,
    },
  };
}

export function collectForbiddenKeys(
  value: unknown,
  path = "",
  out: string[] = [],
): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectForbiddenKeys(item, `${path}[${index}]`, out),
    );
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const next = path ? `${path}.${key}` : key;
      if (
        (AI_EFFECT_STATS_FORBIDDEN_RESPONSE_KEYS as readonly string[]).includes(
          key,
        )
      ) {
        out.push(next);
      }
      collectForbiddenKeys(child, next, out);
    }
  }
  return out;
}

export function responseContainsForbiddenValue(
  value: unknown,
  needles: string[],
): boolean {
  const blob = JSON.stringify(value);
  return needles.some((needle) => needle.length > 0 && blob.includes(needle));
}
